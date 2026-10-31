import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedStudy } from './fixtures/study-db';
import { database, sql } from './fixtures/catalog-db';
let setId: number;
test.beforeEach(async () => {
  ({ setId } = await seedStudy());
});
async function start(page: Page) {
  await page.goto(`/sets/${setId}`);
  await page.getByRole('button', { name: '演習を始める' }).click();
  await expect(page).toHaveURL(/\/sessions\/\d+$/);
  await expect(
    page.getByRole('heading', { name: '問題1', exact: true }),
  ).toBeVisible();
}
function counts() {
  const c = database();
  try {
    return {
      sessions: (
        c.client.prepare('select count(*) n from study_sessions').get() as {
          n: number;
        }
      ).n,
      answered: (
        c.client
          .prepare(
            'select count(*) n from study_items where answered_at is not null',
          )
          .get() as { n: number }
      ).n,
    };
  } finally {
    c.close();
  }
}

test('real study, explicit next, skip, resume, fixed answers and both themes', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await start(page);
  await expect(page.getByText('教材の根拠です。')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '回答する', exact: true }),
  ).toBeDisabled();
  for (const theme of ['ライト', 'ダーク']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    const choice = page.getByRole('radio', { name: '選択肢A' });
    await page.getByRole('button', { name: 'ダーク', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(choice).toBeFocused();
    expect(
      await choice.evaluate((el) => getComputedStyle(el).outlineStyle),
    ).not.toBe('none');
    await page.screenshot({
      path: info.outputPath(`study-${theme}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: '回答する', exact: true }).click();
  await expect(page.getByRole('heading', { name: '✓ 正解です' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '問題1', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '解説', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('radio').first()).toBeDisabled();
  await page.screenshot({
    path: info.outputPath('study-feedback.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '問題2', exact: true }),
  ).toBeVisible();
  const url = page.url();
  await page.getByRole('link', { name: '中断してホームへ' }).click();
  await page.goto(url);
  await expect(
    page.getByRole('heading', { name: '問題2', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'この問題をスキップ' }).click();
  await expect(
    page.getByRole('heading', { name: '問題3', exact: true }),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: '選択肢A' }).check();
  await page.getByRole('checkbox', { name: '選択肢B' }).check();
  await expect(
    page.getByRole('button', { name: '回答する', exact: true }),
  ).toBeDisabled();
  await page.getByRole('checkbox', { name: '選択肢C' }).check();
  await page.getByRole('button', { name: '回答する', exact: true }).click();
  await expect(page.getByRole('heading', { name: '✓ 正解です' })).toBeVisible();
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '問題2', exact: true }),
  ).toBeVisible();
  await page.getByRole('radio', { name: '選択肢B' }).click();
  await page.getByRole('button', { name: '回答する', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '！不正解です' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '演習が完了しました' }),
  ).toBeVisible();
  await expect(page.getByText('正答 2 / 3問')).toBeVisible();
  expect(counts()).toEqual({ sessions: 1, answered: 3 });
  await page.reload();
  await expect(
    page.getByRole('heading', { name: '演習が完了しました' }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('lost start response reuses key after reload and does not duplicate', async ({
  page,
}) => {
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fetch();
    await route.abort();
  });
  await page.goto(`/sets/${setId}`);
  await page.getByRole('button', { name: '演習を始める' }).click();
  await expect(page.getByRole('alert')).toContainText(
    '通信結果を確認できません',
  );
  expect(counts().sessions).toBe(1);
  await page.unroute('**/api/sessions');
  sql(`update question_sets set status='archived' where id=${setId}`);
  await page.reload();
  await page.getByRole('button', { name: '同じ開始要求を確認する' }).click();
  await expect(page).toHaveURL(/\/sessions\/\d+$/);
  expect(counts().sessions).toBe(1);
});

test('failed and unknown answers retain selection and reconcile real storage', async ({
  page,
}) => {
  await start(page);
  await page.getByRole('radio', { name: '選択肢A' }).click();
  await page.route('**/answer', (route) =>
    route.fulfill({ status: 500, body: '{}' }),
  );
  await page.getByRole('button', { name: '回答する', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '保存を再試行する' }),
  ).toBeVisible();
  await expect(page.getByRole('radio', { name: '選択肢A' })).toBeChecked();
  expect(counts().answered).toBe(0);
  await page.getByRole('button', { name: '保存状態を確認する' }).click();
  await expect(
    page.getByText(
      'この回答はまだ保存されていません。同じ選択で保存を再試行できます。',
    ),
  ).toBeVisible();
  await page.unroute('**/answer');
  await page.route('**/answer', async (route) => {
    await route.fetch();
    await route.abort();
  });
  await page.getByRole('button', { name: '保存を再試行する' }).click();
  await expect(
    page.getByRole('button', { name: '保存状態を確認する' }),
  ).toBeVisible();
  expect(counts().answered).toBe(1);
  await page.getByRole('button', { name: '保存状態を確認する' }).click();
  await expect(page.getByRole('heading', { name: '✓ 正解です' })).toBeVisible();
  expect(counts().answered).toBe(1);
});

test('delayed save ignores double click and late result after navigation', async ({
  page,
}) => {
  await start(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/answer', async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole('radio', { name: '選択肢A' }).click();
  await page.getByRole('button', { name: '回答する', exact: true }).dblclick();
  await expect(page.getByText('回答を保存中です。')).toBeVisible();
  await expect.poll(() => counts().answered).toBe(1);
  const url = page.url();
  await page.getByRole('link', { name: '中断してホームへ' }).click();
  release();
  await expect(page.getByRole('heading', { name: '学習ホーム' })).toBeVisible();
  await page.goto(url);
  await expect(
    page.getByRole('heading', { name: '問題2', exact: true }),
  ).toBeVisible();
  expect(counts().answered).toBe(1);
});

test('invalid and non-owner sessions, forbidden response and all excluded', async ({
  page,
}) => {
  for (const id of ['abc', '0', '999999']) {
    await page.goto(`/sessions/${id}`);
    await expect(page.getByRole('alert')).toContainText(
      'この演習または問題を表示できません',
    );
  }
  await start(page);
  const url = page.url();
  sql(
    "insert into users(id,display_name,role,created_at) values(2,'Other','learner',1); update study_sessions set user_id=2",
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText(
    'この演習または問題を表示できません',
  );
  await expect(page.getByRole('radio')).toHaveCount(0);
  sql('update study_sessions set user_id=1');
  await page.goto(url);
  await expect(
    page.getByRole('heading', { name: '問題1', exact: true }),
  ).toBeVisible();
  await page.route('**/answer', (route) =>
    route.fulfill({ status: 403, body: '{}' }),
  );
  await page.getByRole('radio', { name: '選択肢A' }).click();
  await page.getByRole('button', { name: '回答する', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'この環境では演習を利用できません',
  );
  await expect(page.getByRole('radio')).toHaveCount(0);
  sql("update questions set status='stopped'");
  await page.reload();
  await expect(
    page.getByRole('heading', { name: '演習が完了しました' }),
  ).toBeVisible();
  await expect(page.getByText('集計対象なし')).toBeVisible();
  expect(counts().answered).toBe(0);
});

test('publication withdrawal and item read failure offer safe recovery', async ({
  page,
}) => {
  await page.goto(`/sets/${setId}`);
  await expect(
    page.getByRole('button', { name: '演習を始める' }),
  ).toBeEnabled();
  sql(`update question_sets set status='archived' where id=${setId}`);
  await page.getByRole('button', { name: '演習を始める' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'この演習または問題を表示できません',
  );
  expect(counts().sessions).toBe(0);
  sql(`update question_sets set status='published' where id=${setId}`);
  await page.route('**/api/sessions/*/items/*', (route) =>
    route.fulfill({ status: 500, body: '{}' }),
  );
  await page.getByRole('button', { name: '同じ開始要求を確認する' }).click();
  await expect(page.getByRole('alert')).toContainText(
    '通信結果を確認できません',
  );
  await expect(page.getByRole('radio')).toHaveCount(0);
  await page.unroute('**/api/sessions/*/items/*');
  await page.getByRole('button', { name: '再読み込み' }).click();
  await expect(
    page.getByRole('heading', { name: '問題1', exact: true }),
  ).toBeVisible();
  expect(counts().sessions).toBe(1);
});

test('pending skip disables old choices until the next question is ready', async ({
  page,
}) => {
  await start(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/skip', async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page
      .getByRole('button', { name: 'この問題をスキップ', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: '問題1', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('radio', { name: '選択肢A', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: '回答する', exact: true }),
    ).toBeDisabled();
  } finally {
    release();
  }
  await expect(
    page.getByRole('heading', { name: '問題2', exact: true }),
  ).toBeVisible();
  await page.getByRole('radio', { name: '選択肢A', exact: true }).check();
  await page.getByRole('button', { name: '回答する', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '次へ', exact: true }),
  ).toBeVisible();
  expect(counts()).toEqual({ sessions: 1, answered: 1 });
});
