import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { database, emptyCatalog, sql } from '../e2e/fixtures/catalog-db';
import type { AdminSetDetail } from '../../app/utils/admin-sets';

test.beforeEach(() => emptyCatalog());
async function draft(
  request: APIRequestContext,
  count = 2,
  sourceText = '教材の根拠です。',
) {
  const sourceResponse = await request.post('/api/admin/sources', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { title: 'セット用教材', body: sourceText },
  });
  expect(sourceResponse.status()).toBe(201);
  const source = await sourceResponse.json();
  const response = await request.post(
    `/api/admin/sources/${source.id}/generations`,
    {
      headers: { 'Idempotency-Key': randomUUID() },
      data: { title: '管理用セット', requestedCount: count },
    },
  );
  expect(response.status()).toBe(201);
  const run = await response.json();
  expect(run.status).toBe('succeeded');
  return run.setId as number;
}
async function read(
  request: APIRequestContext,
  id: number,
): Promise<AdminSetDetail> {
  return (await request.get(`/api/admin/sets/${id}`)).json();
}
function candidate(page: Page, index = 1) {
  return page.getByRole('region', { name: `候補 ${index}`, exact: true });
}
async function confirm(page: Page, index = 1, mismatch = false) {
  const region = candidate(page, index);
  await region
    .getByLabel('問題・選択肢・正答・解説・引用の内容を確認しました', {
      exact: true,
    })
    .check();
  if (mismatch)
    await region
      .getByLabel('引用不一致の警告を確認し、内容を確認しました', {
        exact: true,
      })
      .check();
  await region
    .getByRole('button', { name: `候補 ${index} の確認を記録`, exact: true })
    .click();
  await expect(region.getByText('確認済み', { exact: true })).toBeVisible();
}
async function adopt(page: Page, indices = [1]) {
  for (const index of indices)
    await candidate(page, index)
      .getByLabel(`候補 ${index} を採用する`, { exact: true })
      .check();
  await page
    .getByRole('button', { name: '採用と順序を保存', exact: true })
    .click();
  await expect(
    page.getByText('採用する問題と順序を保存しました。', { exact: true }),
  ).toBeVisible();
}
async function publish(page: Page, revision = false) {
  await page
    .getByLabel('採用した内容・順序と公開範囲を確認して公開します', {
      exact: true,
    })
    .check();
  await page
    .getByRole('button', {
      name: revision ? '改訂を公開する' : '公開する',
      exact: true,
    })
    .click();
  await expect(
    page.getByText('セットを公開しました。', { exact: true }),
  ).toBeVisible();
}
async function clone(page: Page) {
  await page.getByLabel('改訂セット名', { exact: true }).fill('改訂セット');
  await page
    .getByLabel('元の公開内容と過去回答を保持して改訂下書きを作成します', {
      exact: true,
    })
    .check();
  await page
    .getByRole('button', { name: '改訂下書きを作成する', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: '改訂セット', exact: true }),
  ).toBeVisible();
}
async function changeBody(region: Locator, text: string) {
  await region.getByRole('button', { name: /の内容を編集$/ }).click();
  await region.getByLabel('問題文', { exact: true }).fill(text);
  await region.getByRole('button', { name: '内容を保存', exact: true }).click();
}

test('edits 6-choice/multiple-answer content, requires reconfirmation, saves order and publishes with themes/keyboard', async ({
  page,
  request,
}, info) => {
  const id = await draft(request);
  await page.goto('/admin/sets');
  await page.getByRole('link', { name: '管理用セット', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '公開する', exact: true }),
  ).toBeDisabled();
  const first = candidate(page);
  await expect(
    first.getByLabel('候補 1 を採用する', { exact: true }),
  ).toBeDisabled();
  await confirm(page);
  await first
    .getByRole('button', { name: '候補 1 の内容を編集', exact: true })
    .click();
  for (let i = 3; i <= 6; i++) {
    await first
      .getByRole('button', { name: '選択肢を追加', exact: true })
      .click();
    await first
      .getByLabel(`選択肢 ${i}`, { exact: true })
      .fill(`追加の選択肢 ${i}`);
  }
  await expect(
    first.getByRole('button', { name: '選択肢を追加', exact: true }),
  ).toBeDisabled();
  await first.getByLabel('選択肢 3 を正答にする', { exact: true }).check();
  await first.getByLabel('選択肢 6 を正答にする', { exact: true }).check();
  await first
    .getByLabel('問題文', { exact: true })
    .fill('編集した問題 <script>PRIVATE_SCRIPT</script>');
  await first.getByRole('button', { name: '内容を保存', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(first.getByText('未確認', { exact: true })).toBeVisible();
  await expect(first.getByText('正答数: 3', { exact: true })).toBeVisible();
  await confirm(page);
  await confirm(page, 2);
  await adopt(page, [1, 2]);
  await page
    .getByRole('button', { name: '採用 2 を上へ', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '公開する', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: '採用と順序を保存', exact: true })
    .click();
  const before = await read(request, id);
  expect(before.items.map((item) => item.versionId)).toEqual([
    before.candidates[1]!.id,
    before.candidates[0]!.id,
  ]);
  await publish(page);
  await expect(
    first.getByRole('button', { name: '候補 1 の内容を編集' }),
  ).toHaveCount(0);
  expect((await read(request, id)).status).toBe('published');
  for (const label of ['ライト', 'ダーク']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.screenshot({
      path: info.outputPath(`sets-${label}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  const html = await (await request.get(`/admin/sets/${id}`)).text();
  expect(html).not.toContain('PRIVATE_SCRIPT');
});

test('requires explicit quote mismatch acknowledgement and never publishes zero adoption', async ({
  page,
  request,
}) => {
  const id = await draft(request, 1, '引用が存在しない教材');
  await page.goto(`/admin/sets/${id}`);
  const first = candidate(page);
  await expect(
    first.getByText(
      '引用が教材本文に一致していません。引用と内容を確認してください。',
      { exact: true },
    ),
  ).toBeVisible();
  await first
    .getByLabel('問題・選択肢・正答・解説・引用の内容を確認しました', {
      exact: true,
    })
    .check();
  await expect(
    first.getByRole('button', { name: '候補 1 の確認を記録', exact: true }),
  ).toBeDisabled();
  await confirm(page, 1, true);
  await expect(
    page.getByRole('button', { name: '公開する', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      '採用は0問です。1〜10問を採用し、保存するまで公開できません。',
      { exact: true },
    ),
  ).toBeVisible();
  expect((await read(request, id)).status).toBe('draft');
});

test('clones immutable publication, saves a derived version, reconfirms and atomically publishes the revision', async ({
  page,
  request,
}) => {
  const id = await draft(request, 1);
  await page.goto(`/admin/sets/${id}`);
  await confirm(page);
  await adopt(page);
  await publish(page);
  const original = await read(request, id);
  const session = await (
    await request.post('/api/sessions', {
      headers: { 'Idempotency-Key': randomUUID() },
      data: { setId: id },
    })
  ).json();
  const answerResponse = await request.post(
    `/api/sessions/${session.session.id}/items/${session.session.currentItemId}/answer`,
    { data: { selectedIds: original.candidates[0]!.answerIds } },
  );
  expect(answerResponse.status()).toBe(200);
  const historyDb = database();
  let originalAnswer: unknown;
  try {
    originalAnswer = historyDb.client
      .prepare('select * from study_items where session_id=?')
      .get(session.session.id);
  } finally {
    historyDb.close();
  }
  await clone(page);
  const revisedId = Number(new URL(page.url()).pathname.split('/').at(-1));
  await changeBody(candidate(page), '派生版の問題文');
  await expect(
    candidate(page).getByText('未確認', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '改訂を公開する', exact: true }),
  ).toBeDisabled();
  const edited = await read(request, revisedId);
  expect(edited.candidates[0]!.id).not.toBe(original.candidates[0]!.id);
  expect(edited.candidates[0]!.derivedFromVersionId).toBe(
    original.candidates[0]!.id,
  );
  expect((await read(request, id)).candidates[0]!.body).toBe(
    original.candidates[0]!.body,
  );
  await confirm(page);
  await publish(page, true);
  expect((await read(request, id)).status).toBe('archived');
  expect((await read(request, revisedId)).status).toBe('published');
  const c = database();
  try {
    const saved = c.client
      .prepare(
        'select question_version_id as id from study_items where session_id=?',
      )
      .get(session.session.id) as { id: number };
    expect(saved.id).toBe(original.candidates[0]!.id);
    expect(
      c.client
        .prepare('select * from study_items where session_id=?')
        .get(session.session.id),
    ).toEqual(originalAnswer);
  } finally {
    c.close();
  }
});

test('separates set archival from all-version stop and preserves existing history', async ({
  page,
  request,
}) => {
  const id = await draft(request, 1);
  await page.goto(`/admin/sets/${id}`);
  await confirm(page);
  await adopt(page);
  await publish(page);
  await page
    .getByLabel('新規の演習開始を停止する影響を確認しました', { exact: true })
    .check();
  await page
    .getByRole('button', { name: 'セットを公開停止にする', exact: true })
    .click();
  await expect(
    page.getByText('セットの新規演習開始を停止しました。', { exact: true }),
  ).toBeVisible();
  const archived = await read(request, id);
  expect(archived.status).toBe('archived');
  expect(archived.items[0]!.questionStatus).toBe('active');
  await candidate(page).locator('summary').click();
  await candidate(page)
    .getByLabel('全版に影響する出題停止を確認しました', { exact: true })
    .check();
  await candidate(page)
    .getByRole('button', { name: /の全版を停止$/ })
    .click();
  await expect(
    page.getByText('この問題の全版の出題を停止しました。', { exact: true }),
  ).toBeVisible();
  const stopped = await read(request, id);
  expect(stopped.items[0]!.questionStatus).toBe('stopped');
  expect(stopped.candidates[0]!.body).toBe(archived.candidates[0]!.body);
});

test('retains edit input on a real revision conflict and requires explicit refresh/rebase', async ({
  page,
  request,
}) => {
  const id = await draft(request, 1);
  await page.goto(`/admin/sets/${id}`);
  const initial = await read(request, id);
  const version = initial.candidates[0]!;
  const first = candidate(page);
  await first
    .getByRole('button', { name: '候補 1 の内容を編集', exact: true })
    .click();
  await first
    .getByLabel('問題文', { exact: true })
    .fill('この画面の未保存入力');
  const response = await request.put(
    `/api/admin/sets/${id}/versions/${version.id}/content`,
    {
      data: {
        expectedRevision: initial.revision,
        expectedFingerprint: version.fingerprint,
        body: '別操作で保存した内容',
        choices: version.choices,
        answerIds: version.answerIds,
        explanation: version.explanation,
        quote: version.quote,
      },
    },
  );
  expect(response.status()).toBe(200);
  await first.getByRole('button', { name: '内容を保存', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText(
    '保存完了とは判断せず',
  );
  await expect(first.getByLabel('問題文', { exact: true })).toHaveValue(
    'この画面の未保存入力',
  );
  await page
    .getByRole('button', { name: '最新状態を確認', exact: true })
    .click();
  await expect(
    first.getByText('別操作で保存した内容', { exact: true }),
  ).toBeVisible();
  await expect(
    first.getByRole('button', { name: '内容を保存', exact: true }),
  ).toBeDisabled();
  await expect(first.getByLabel('問題文', { exact: true })).toHaveValue(
    'この画面の未保存入力',
  );
  await first
    .getByRole('button', {
      name: '入力を破棄して最新内容から編集し直す',
      exact: true,
    })
    .click();
  await expect(first.getByLabel('問題文', { exact: true })).toHaveValue(
    '別操作で保存した内容',
  );
});

test('reconciles a lost content response with GET and keeps the attempted edit', async ({
  page,
  request,
}) => {
  const id = await draft(request, 1);
  await page.goto(`/admin/sets/${id}`);
  await confirm(page);
  await adopt(page);
  await publish(page);
  await clone(page);
  const revisedId = Number(new URL(page.url()).pathname.split('/').at(-1));
  await page.route('**/versions/*/content', async (route) => {
    await route.fetch();
    await route.abort();
    await page.unroute('**/versions/*/content');
  });
  await changeBody(candidate(page), '応答喪失でも保持する入力');
  await expect(page.getByRole('alert').first()).toContainText(
    '保存完了とは判断せず',
  );
  await page
    .getByRole('button', { name: '最新状態を確認', exact: true })
    .click();
  await expect(
    candidate(page).getByLabel('問題文', { exact: true }),
  ).toHaveValue('応答喪失でも保持する入力');
  await expect(
    candidate(page).getByRole('button', { name: '内容を保存', exact: true }),
  ).toBeDisabled();
  expect((await read(request, revisedId)).candidates[0]!.body).toBe(
    '応答喪失でも保持する入力',
  );
  await expect(
    page.getByText('内容を保存しました。変更した問題は再確認が必要です。', {
      exact: true,
    }),
  ).toHaveCount(0);
});

test('replays a lost revision creation with the same receipt instead of creating two drafts', async ({
  page,
  request,
}) => {
  const id = await draft(request, 1);
  await page.goto(`/admin/sets/${id}`);
  await confirm(page);
  await adopt(page);
  await publish(page);
  let requestKey = '';
  await page.route('**/revisions', async (route) => {
    requestKey = route.request().postDataJSON().requestKey;
    await route.fetch();
    await route.abort();
    await page.unroute('**/revisions');
  });
  await page
    .getByLabel('元の公開内容と過去回答を保持して改訂下書きを作成します', {
      exact: true,
    })
    .check();
  await page
    .getByRole('button', { name: '改訂下書きを作成する', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('同じ受付を再確認');
  const replay = page.waitForRequest((request) =>
    request.url().endsWith('/revisions'),
  );
  await page
    .getByRole('button', { name: '同じ改訂受付を再確認', exact: true })
    .click();
  expect((await replay).postDataJSON().requestKey).toBe(requestKey);
  await expect(page).not.toHaveURL(new RegExp(`/admin/sets/${id}$`));
  const c = database();
  try {
    expect(
      c.client
        .prepare(
          'select count(*) n from question_sets where supersedes_set_id=?',
        )
        .get(id),
    ).toEqual({ n: 1 });
  } finally {
    c.close();
  }
});

test('refuses stale-source revision publication without a partial state change', async ({
  page,
  request,
}) => {
  const id = await draft(request, 1);
  await page.goto(`/admin/sets/${id}`);
  await confirm(page);
  await adopt(page);
  await publish(page);
  await clone(page);
  const revisedId = Number(new URL(page.url()).pathname.split('/').at(-1));
  expect(
    (
      await request.post(`/api/admin/sets/${id}/archive`, { data: {} })
    ).status(),
  ).toBe(200);
  await page
    .getByLabel('採用した内容・順序と公開範囲を確認して公開します', {
      exact: true,
    })
    .check();
  await page
    .getByRole('button', { name: '改訂を公開する', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('最新状態');
  expect((await read(request, revisedId)).status).toBe('draft');
  expect((await read(request, id)).status).toBe('archived');
  await expect(
    page.getByText('セットを公開しました。', { exact: true }),
  ).toHaveCount(0);
});

test('clears private candidates and edit buffers on 403', async ({
  page,
  request,
}) => {
  const id = await draft(request, 1);
  await page.goto(`/admin/sets/${id}`);
  await candidate(page)
    .getByRole('button', { name: '候補 1 の内容を編集', exact: true })
    .click();
  await candidate(page)
    .getByLabel('問題文', { exact: true })
    .fill('PRIVATE_EDIT_BUFFER');
  sql("update users set role='learner'");
  await candidate(page)
    .getByRole('button', { name: '内容を保存', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('管理者');
  await expect(
    page.getByRole('region', { name: '候補 1', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('PRIVATE_EDIT_BUFFER');
  await page.goto('/admin/sets');
  await expect(page.getByRole('alert')).toContainText('管理者');
  await expect(
    page.getByRole('link', { name: '管理用セット', exact: true }),
  ).toHaveCount(0);
});

test('can remove a stopped adopted candidate and publish the remaining valid selection', async ({
  page,
  request,
}) => {
  const id = await draft(request, 2);
  await page.goto(`/admin/sets/${id}`);
  await confirm(page);
  await confirm(page, 2);
  await adopt(page, [1, 2]);
  await candidate(page).locator('summary').click();
  await candidate(page)
    .getByLabel('全版に影響する出題停止を確認しました', { exact: true })
    .check();
  await candidate(page)
    .getByRole('button', { name: /の全版を停止$/ })
    .click();
  await expect(
    page.getByText('この問題の全版の出題を停止しました。', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '公開する', exact: true }),
  ).toBeDisabled();
  await candidate(page)
    .getByLabel('候補 1 を採用する', { exact: true })
    .uncheck();
  await page
    .getByRole('button', { name: '採用と順序を保存', exact: true })
    .click();
  await expect(
    page.getByText('採用する問題と順序を保存しました。', { exact: true }),
  ).toBeVisible();
  await publish(page);
  expect((await read(request, id)).items).toHaveLength(1);
});

test('displays the empty and loading set list without private SSR data', async ({
  page,
}, info) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/admin/sets?*', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/admin/sets');
  await expect(
    page.getByText('セットを読み込み中です。', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('sets-loading.png'),
    fullPage: true,
  });
  release();
  await expect(
    page.getByText(
      'セットはまだありません。教材の詳細から問題を生成してください。',
      { exact: true },
    ),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('sets-empty.png'),
    fullPage: true,
  });
});
