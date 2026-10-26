import { expect, test } from '@playwright/test';
import { seedCatalog, sql } from './fixtures/catalog-db';
let fixture: Awaited<ReturnType<typeof seedCatalog>>;
test.beforeEach(async () => {
  fixture = await seedCatalog();
});

test('real catalog pagination, direct detail, privacy, themes and keyboard navigation', async ({
  page,
  request,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error' || /hydration/i.test(e.text()))
      errors.push(e.text());
  });
  const responses: string[] = [];
  page.on('response', async (response) => {
    if (response.url().includes('/api/sets'))
      responses.push(await response.text());
  });
  const ssr = await request.get('/');
  expect(await ssr.text()).not.toContain('公開セット22');
  await page.goto('/');
  await expect(
    page.getByRole('list', { name: '公開セット' }).getByRole('listitem'),
  ).toHaveCount(20);
  for (const theme of ['ライト', 'ダーク']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.screenshot({
      path: info.outputPath(`catalog-${theme}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole('button', { name: 'もっと見る' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(22);
  await expect(page.getByRole('button', { name: 'もっと見る' })).toHaveCount(0);
  const link = page.getByRole('link', { name: /の詳細を見る/ }).first();
  await link.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(link).toBeFocused();
  expect(
    await link.evaluate((el) => getComputedStyle(el).outlineStyle),
  ).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('現在出題可能な問題はありません', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('演習画面は準備中です')).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('現在出題可能な問題はありません', { exact: true }),
  ).toBeVisible();
  for (const theme of ['ライト', 'ダーク']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.screenshot({
      path: info.outputPath(`detail-${theme}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole('link', { name: '一覧へ戻る' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listitem')).toHaveCount(20);
  for (const text of [...responses, await page.content()])
    expect(text).not.toMatch(/SECRET_|answerIds|explanation|userId/);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => /catalog|sets/i.test(k)),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test('unavailable ids and publication withdrawal do not disclose private titles', async ({
  page,
}, info) => {
  for (const id of [fixture.draftId, fixture.archivedId, 999999, 'abc', 0]) {
    await page.goto(`/sets/${id}`);
    await expect(
      page.getByRole('heading', { name: '現在このセットを表示できません' }),
    ).toBeVisible();
    expect(await page.content()).not.toMatch(/SECRET_/);
  }
  await page.goto(`/sets/${fixture.ids[0]}`);
  await expect(
    page.getByRole('heading', { name: '公開セット1', exact: true }),
  ).toBeVisible();
  sql(`update question_sets set status='archived' where id=${fixture.ids[0]}`);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: '現在このセットを表示できません' }),
  ).toBeVisible();
  for (const theme of ['ライト', 'ダーク']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.screenshot({
      path: info.outputPath(`unavailable-${theme}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test('initial and additional failures retry explicitly with the same cursor', async ({
  page,
}) => {
  let fail = true;
  const cursors: string[] = [];
  await page.route('**/api/sets?**', async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('before');
    if (cursor) cursors.push(cursor);
    if (fail) {
      fail = false;
      await route.fulfill({ status: 500, body: 'SECRET_STACK' });
    } else await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('読み込みに失敗');
  await expect(page.getByText('学習できる問題はまだありません')).toHaveCount(0);
  await page.getByRole('button', { name: '再試行' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(20);
  fail = true;
  await page.getByRole('button', { name: 'もっと見る' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(20);
  await page.getByRole('button', { name: '再試行' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(22);
  expect(cursors).toHaveLength(2);
  expect(cursors[0]).toBe(cursors[1]);
});

test('learner access and missing local user rejection clear previously loaded data', async ({
  page,
}) => {
  sql("update users set role='learner' where id=1");
  await page.goto('/');
  await expect(page.getByRole('listitem')).toHaveCount(20);
  sql('pragma foreign_keys=off; update users set id=2 where id=1');
  await page.getByRole('button', { name: 'もっと見る' }).click();
  await expect(page.getByRole('alert')).toContainText('利用設定または権限');
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await page.goto(`/sets/${fixture.ids[0]}`);
  await expect(page.getByRole('alert')).toContainText('利用設定または権限');
});

test('detail failure retries and a late response cannot overwrite another detail', async ({
  page,
}) => {
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let completed!: () => void;
  const responseCompleted = new Promise<void>((resolve) => {
    completed = resolve;
  });
  const id = fixture.ids[0]!;
  await page.route(`**/api/sets/${id}`, async (route) => {
    started();
    await gate;
    await route.fulfill({ status: 500, body: 'SECRET_STACK' });
    completed();
  });
  await page.goto(`/sets/${id}`);
  await pending;
  await expect(page.getByRole('status')).toContainText('読み込み中');
  await page.getByRole('link', { name: '一覧へ戻る' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(20);
  await page
    .getByRole('link', { name: /の詳細を見る/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    '公開セット22',
  );
  release();
  await responseCompleted;
  await page.unroute(`**/api/sets/${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    '公開セット22',
  );
  let fail = true;
  await page.route(`**/api/sets/${id}`, (route) =>
    fail
      ? ((fail = false), route.fulfill({ status: 500, body: 'SECRET_STACK' }))
      : route.continue(),
  );
  await page.goto(`/sets/${id}`);
  await expect(page.getByRole('alert')).toContainText('読み込みに失敗');
  await page.getByRole('button', { name: '再試行' }).click();
  await expect(
    page.getByRole('heading', { name: '公開セット1', exact: true }),
  ).toBeVisible();
});
