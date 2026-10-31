import { createSource } from '../../server/services/sources';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { e2eDatabasePath } from '../../scripts/e2e-database';
import { database, emptyCatalog, sql } from '../e2e/fixtures/catalog-db';

test.beforeEach(() => emptyCatalog());
async function register(page: Page, body = '教材の根拠です。') {
  await page.goto('/admin/sources/new');
  await page.getByLabel('タイトル', { exact: true }).fill('ブラウザ教材');
  await page.getByLabel('教材本文', { exact: true }).fill(body);
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/sources\/[1-9][0-9]*$/);
  await expect(
    page.getByRole('heading', { name: 'ブラウザ教材', exact: true }),
  ).toBeVisible();
}
function counts() {
  const c = database();
  try {
    return {
      sources: c.client.prepare('select count(*) n from sources').get() as {
        n: number;
      },
      runs: c.client
        .prepare('select count(*) n from generation_runs')
        .get() as { n: number },
    };
  } finally {
    c.close();
  }
}

test('registers escaped text and generates a single real draft with keyboard, themes and reload recovery', async ({
  page,
}, info) => {
  await page.goto('/admin/sources');
  await expect(
    page.getByText('教材はまだありません。テキスト教材を登録してください。'),
  ).toBeVisible();
  await register(page, '教材の根拠です。<script>window.LEAK = true</script>');
  expect(await page.evaluate(() => 'LEAK' in window)).toBe(false);
  await page.getByLabel('セット名', { exact: true }).fill('確認用セット');
  await page.getByLabel('問数', { exact: true }).fill('2');
  await page.getByRole('button', { name: '生成する', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('生成が完了しました', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/作成した下書きセット: #/)).toBeVisible();
  await expect(page.getByText(/状態更新日時:/)).toBeVisible();
  expect(counts().runs.n).toBe(1);
  const stored = await page.evaluate(() => JSON.stringify(sessionStorage));
  expect(stored).not.toContain('window.LEAK');
  expect(stored).not.toContain('TEST_ONLY_KEY');
  await page.reload();
  await expect(
    page.getByText('生成が完了しました', { exact: true }),
  ).toBeVisible();
  expect(counts().runs.n).toBe(1);
  for (const label of ['ライト', 'ダーク']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.screenshot({
      path: info.outputPath(`sources-${label}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await expect(
    page.getByRole('link', { name: '下書きセットを確認' }),
  ).toHaveAttribute('href', /\/admin\/sets\/[1-9][0-9]*$/);
  const response = await page.request.get(new URL(page.url()).pathname);
  expect(await response.text()).not.toContain('window.LEAK');
});

test('keeps source input and idempotency after a lost save response', async ({
  page,
}) => {
  let key = '';
  await page.route('**/api/admin/sources', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    key = route.request().headers()['idempotency-key']!;
    await route.fetch();
    await route.abort();
    await page.unroute('**/api/admin/sources');
  });
  await page.goto('/admin/sources/new');
  await page.getByLabel('タイトル', { exact: true }).fill('失わない教材');
  await page.getByLabel('教材本文', { exact: true }).fill('入力した本文');
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('通信または処理');
  await expect(page.getByLabel('教材本文', { exact: true })).toHaveValue(
    '入力した本文',
  );
  let replayKey = '';
  page.on('request', (request) => {
    if (request.method() === 'POST')
      replayKey = request.headers()['idempotency-key'] ?? '';
  });
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '失わない教材' }),
  ).toBeVisible();
  expect(replayKey).toBe(key);
  expect(counts().sources.n).toBe(1);
});

test('failed generation preserves the source and requires explicit acknowledgement for a new attempt', async ({
  page,
}) => {
  await register(page, 'SCENARIO_REJECT 教材の根拠です。');
  await page.getByRole('button', { name: '生成する', exact: true }).click();
  await expect(
    page.getByText('生成に失敗しました', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '新しい試行を開始', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: '同じ受付を確認', exact: true })
    .click();
  expect(counts().runs.n).toBe(1);
  await page
    .getByLabel(
      '以前の処理が続く可能性と追加課金を理解して、新しい試行を開始する',
    )
    .check();
  await page
    .getByRole('button', { name: '新しい試行を開始', exact: true })
    .click();
  await expect.poll(() => counts().runs.n).toBe(2);
  await expect(
    page.getByText('生成に失敗しました', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('SCENARIO_REJECT 教材の根拠です。', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('body')).not.toContainText(
    'TEST_ONLY_SECRET_ERROR',
  );
});

test('recovers a lost generation receipt with the original input after reload', async ({
  page,
}) => {
  let key = '';
  await register(page);
  await page.route('**/api/admin/sources/*/generations', async (route) => {
    key = route.request().headers()['idempotency-key']!;
    await route.fetch();
    await route.abort();
    await page.unroute('**/api/admin/sources/*/generations');
  });
  await page.getByRole('button', { name: '生成する', exact: true }).click();
  await expect(
    page.getByText('状態不明（受付の応答を確認できていません）', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.reload();
  await page
    .getByLabel('セット名', { exact: true })
    .fill('変更しても受付には使わない');
  const replay = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && request.url().endsWith('/generations'),
  );
  await page
    .getByRole('button', { name: '同じ受付を確認', exact: true })
    .click();
  const request = await replay;
  expect(request.headers()['idempotency-key']).toBe(key);
  expect(request.postDataJSON().title).toBe('ブラウザ教材');
  await expect(
    page.getByText('生成が完了しました', { exact: true }),
  ).toBeVisible();
  expect(counts().runs.n).toBe(1);
});

test('shows a durable running receipt and stops polling on navigation', async ({
  page,
}) => {
  const token = randomUUID();
  await register(page, `SCENARIO_PENDING:${token} 教材の根拠です。`);
  await page.getByRole('button', { name: '生成する', exact: true }).click();
  const events = join(dirname(e2eDatabasePath()), 'generation-events');
  await expect
    .poll(() => {
      try {
        return readFileSync(events, 'utf8');
      } catch {
        return '';
      }
    })
    .toContain(`called:${token}`);
  await page
    .getByRole('button', { name: '同じ受付を確認', exact: true })
    .click();
  await expect(
    page.getByText('問題を生成中（running）', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/runningは処理の生存を保証しません/),
  ).toBeVisible();
  let queries = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/admin/generations/')) queries++;
  });
  await page.getByRole('link', { name: '教材一覧', exact: true }).click();
  const before = queries;
  await page.waitForTimeout(3500);
  expect(queries).toBe(before);
  writeFileSync(`${events}.${token}.release`, 'release');
});

test('clears management content when authorization is lost and rejects learners', async ({
  page,
}) => {
  await register(page, 'PRIVATE_ADMIN_BODY');
  sql("update users set role='learner'");
  await page.getByRole('button', { name: '生成する', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: '管理者としてこの操作を利用できません。',
    }),
  ).toBeVisible();
  await expect(page.locator('body')).not.toContainText('PRIVATE_ADMIN_BODY');
  expect(
    await page.evaluate(() => JSON.stringify(sessionStorage)),
  ).not.toContain('mediquest.generation.');
  await page.goto('/admin/sources/new');
  await expect(page.getByRole('alert')).toContainText('管理者');
  await expect(page.getByLabel('教材本文', { exact: true })).toHaveCount(0);
});

test('ignores an old delayed response after a new explicit generation', async ({
  page,
}) => {
  await register(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posts = 0;
  await page.route('**/api/admin/sources/*/generations', async (route) => {
    posts++;
    if (posts !== 1) return route.continue();
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await page.getByLabel('セット名', { exact: true }).fill('古い試行');
  await page.getByRole('button', { name: '生成する', exact: true }).click();
  await expect.poll(() => counts().runs.n).toBe(1);
  await page
    .getByRole('button', { name: '同じ受付を確認', exact: true })
    .click();
  await expect(
    page.getByText('生成が完了しました', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('セット名', { exact: true }).fill('新しい試行');
  await page
    .getByLabel(
      '以前の処理が続く可能性と追加課金を理解して、新しい試行を開始する',
    )
    .check();
  await page
    .getByRole('button', { name: '新しい試行を開始', exact: true })
    .click();
  await expect.poll(() => counts().runs.n).toBe(2);
  await expect(
    page.getByText('生成が完了しました', { exact: true }),
  ).toBeVisible();
  release();
  await expect(
    page.getByText('受付したセット: 新しい試行（5問）', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('受付したセット: 古い試行（5問）', { exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await page
    .getByRole('button', { name: '古い試行の受付を確認', exact: true })
    .click();
  await expect(
    page.getByText('受付したセット: 古い試行（5問）', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('生成が完了しました', { exact: true }),
  ).toBeVisible();
  expect(counts().runs.n).toBe(2);
});

test('restores an old running receipt without inventing timeout failure', async ({
  page,
}) => {
  await register(page);
  await page.getByRole('button', { name: '生成する', exact: true }).click();
  await expect(
    page.getByText('生成が完了しました', { exact: true }),
  ).toBeVisible();
  sql(
    "update generation_runs set status='running', started_at=1, finished_at=null",
  );
  await page.reload();
  await expect(
    page.getByText('問題を生成中（running）', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/状態更新日時:/)).toContainText('1970');
  await page
    .getByRole('button', { name: '同じ受付を確認', exact: true })
    .click();
  await expect(
    page.getByText('問題を生成中（running）', { exact: true }),
  ).toBeVisible();
  expect(counts().runs.n).toBe(1);
});

test('handles malformed receipts and unavailable storage without discarding the current receipt', async ({
  page,
}) => {
  await register(page);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.evaluate(
    (source) =>
      sessionStorage.setItem(`mediquest.generation.${source}`, '{bad'),
    id,
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText(
    '保存された受付を読み取れません',
  );
  await expect(
    page.getByRole('button', { name: '生成する', exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel(
      '以前の処理が続く可能性と追加課金を理解して、新しい試行を開始する',
    )
    .check();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
  });
  await page.getByRole('button', { name: '生成する', exact: true }).click();
  await expect(
    page.getByText('生成が完了しました', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(
    'このタブに受付を保存できません',
  );
  await page
    .getByRole('button', { name: '同じ受付を確認', exact: true })
    .click();
  expect(counts().runs.n).toBe(1);
});

test('rejects administrator content when local mode is disabled', async ({
  page,
  request,
}) => {
  await register(page, 'LOCAL_DISABLED_PRIVATE_BODY');
  const path = new URL(page.url()).pathname;
  const child = spawn(
    process.execPath,
    ['.nuxt/admin-e2e-output/server/index.mjs'],
    {
      env: {
        ...process.env,
        NITRO_HOST: '127.0.0.1',
        NITRO_PORT: '3103',
        MEDIQUEST_DB_PATH: e2eDatabasePath(),
        MEDIQUEST_LOCAL_MODE: 'false',
      },
      stdio: 'ignore',
    },
  );
  const exited = new Promise<void>((resolve, reject) => {
    child.once('exit', () => resolve());
    child.once('error', reject);
  });
  try {
    await expect
      .poll(async () => {
        try {
          return (
            await request.get('http://127.0.0.1:3103/api/health')
          ).status();
        } catch {
          return 0;
        }
      })
      .toBe(200);
    await page.goto(`http://127.0.0.1:3103${path}`);
    await expect(
      page.getByRole('heading', {
        name: '管理者としてこの操作を利用できません。',
      }),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText(
      'LOCAL_DISABLED_PRIVATE_BODY',
    );
    expect(
      (await request.get(`http://127.0.0.1:3103/api${path}`)).status(),
    ).toBe(403);
  } finally {
    child.kill('SIGTERM');
    await exited;
  }
});

test('retains list pages on retry, displays loading, and clears private titles on 403', async ({
  page,
}, info) => {
  const c = database();
  try {
    for (let i = 0; i < 21; i++)
      createSource(
        c,
        { title: `PRIVATE_SOURCE_${i}`, body: '教材本文' },
        randomUUID(),
      );
  } finally {
    c.close();
  }
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route('**/api/admin/sources?*', async (route) => {
    calls++;
    if (calls === 1) {
      await held;
      return route.continue();
    }
    if (calls === 2)
      return route.fulfill({
        status: 500,
        json: { error: { message: 'PRIVATE_STACK_SECRET' } },
      });
    return route.continue();
  });
  await page.goto('/admin/sources');
  await expect(
    page.getByText('教材を読み込み中です。', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('sources-loading.png'),
    fullPage: true,
  });
  release();
  await expect(page.locator('main li')).toHaveCount(20);
  await page
    .getByRole('button', { name: 'さらに読み込む', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('通信または処理');
  await expect(page.locator('main li')).toHaveCount(20);
  await expect(page.locator('body')).not.toContainText('PRIVATE_STACK_SECRET');
  await page.screenshot({
    path: info.outputPath('sources-error.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '再確認', exact: true }).click();
  await expect(page.locator('main li')).toHaveCount(21);
  sql("update users set role='learner'");
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('管理者');
  await expect(page.locator('body')).not.toContainText('PRIVATE_SOURCE_');
});
