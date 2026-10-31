import { expect, test } from '@playwright/test';
import { seedHistory, revise } from './fixtures/history-db';
import { database, sql } from './fixtures/catalog-db';

function reviewCount() {
  const c = database();
  try {
    return (
      c.client
        .prepare("select count(*) n from study_sessions where mode='review'")
        .get() as { n: number }
    ).n;
  } finally {
    c.close();
  }
}

test('own history pages, interrupted home, keyboard and both themes', async ({
  page,
}, info) => {
  const f = await seedHistory(21);
  await page.goto('/history');
  const list = page.getByRole('list', { name: '履歴一覧' });
  await expect(list.getByRole('listitem')).toHaveCount(20);
  await page.getByRole('button', { name: '履歴をもっと見る' }).focus();
  await page.keyboard.press('Enter');
  await expect(list.getByRole('listitem')).toHaveCount(23);
  await expect(
    page.getByRole('link', { name: `演習${f.other}の結果を見る`, exact: true }),
  ).toHaveCount(0);
  for (const theme of ['ライト', 'ダーク']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.screenshot({
      path: info.outputPath(`history-${theme}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page
    .getByRole('link', { name: `演習${f.interrupted}を再開する`, exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: '問題2', exact: true }),
  ).toBeVisible();
  await page.goto('/');
  const interrupted = page.getByRole('region', { name: '中断した演習' });
  await expect(interrupted.getByRole('listitem')).toHaveCount(5);
  await expect(
    interrupted.getByRole('link', {
      name: new RegExp(`演習${f.completed}を再開`),
    }),
  ).toHaveCount(0);
  await interrupted.getByRole('button', { name: '履歴をもっと見る' }).click();
  await expect(interrupted.getByRole('listitem')).toHaveCount(10);
});

test('saved results and three-answer feedback remain fixed after revision', async ({
  page,
}, info) => {
  const f = await seedHistory();
  await page.goto(`/sessions/${f.completed}/result`);
  await expect(
    page.getByRole('heading', { name: '演習結果', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('67%', { exact: true })).toBeVisible();
  await expect(
    page.getByText('あなたの回答: 選択肢B', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '！不正解です' })).toHaveCount(
    1,
  );
  for (const theme of ['ライト', 'ダーク']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.screenshot({
      path: info.outputPath(`result-${theme}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  revise(f.setId);
  await page.getByRole('button', { name: '結果を更新する' }).click();
  await expect(
    page.getByRole('heading', { name: '問題 1: 問題1', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '！不正解です' })).toHaveCount(
    1,
  );
  expect(await page.content()).not.toContain('NEW_REVISION_EXPLANATION');
  await page.goto(`/sessions/${f.interrupted}/result`);
  await expect(
    page.getByText(
      'スキップ済み・未回答（正解・解説は回答確定後に表示します）',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'AI解説', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '誤答を復習する' }),
  ).toBeDisabled();
});

test('review response loss replays one fixed-version session after archive', async ({
  page,
}) => {
  const f = await seedHistory();
  await page.goto(`/sessions/${f.completed}/result`);
  await page.route('**/reviews', async (route) => {
    await route.fetch();
    await route.abort();
  });
  await page.getByRole('button', { name: '誤答を復習する' }).click();
  await expect(page.getByRole('alert')).toContainText(
    '通信結果を確認できません',
  );
  expect(reviewCount()).toBe(1);
  sql(`update question_sets set status='archived' where id=${f.setId}`);
  await page.unroute('**/reviews');
  await page.reload();
  await page.getByRole('button', { name: '同じ復習要求を確認する' }).click();
  await expect(
    page.getByRole('heading', { name: '問題1', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'AI解説', exact: true }),
  ).toHaveCount(0);
  expect(reviewCount()).toBe(1);
  await page.getByRole('radio', { name: '選択肢A' }).click();
  await page.getByRole('button', { name: '回答する', exact: true }).click();
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByRole('link', { name: '結果を見る', exact: true }).click();
  await expect(page.getByText('100%', { exact: true })).toBeVisible();
  await page.goto(`/sessions/${f.completed}/result`);
  await expect(page.getByText('67%', { exact: true })).toBeVisible();
});

test('stopped wrong answers cannot create reviews and invalidated results retain history', async ({
  page,
}) => {
  const f = await seedHistory();
  sql(
    "update questions set status='stopped' where id=(select question_id from question_versions where body='問題1')",
  );
  await page.goto(`/sessions/${f.completed}/result`);
  await page.getByRole('button', { name: '誤答を復習する' }).click();
  await expect(page.getByRole('alert')).toContainText(
    '現在復習できる誤答がないか',
  );
  expect(reviewCount()).toBe(0);
  sql(
    "update question_versions set invalidated_at=1,invalidated_by=1,invalidation_reason='confirmed'",
  );
  await page.getByRole('button', { name: '結果を更新する' }).click();
  await expect(page.getByText('集計対象なし', { exact: true })).toBeVisible();
  await expect(
    page.getByText('不備確定のため集計から除外', { exact: true }),
  ).toHaveCount(3);
  await expect(
    page.getByRole('heading', { name: 'AI解説', exact: true }),
  ).toHaveCount(0);
  await page.goto(`/sessions/${f.interrupted}/result`);
  await expect(page.getByText('集計対象なし', { exact: true })).toBeVisible();
  await expect(
    page.getByText('再開すると、対象のない演習の完了状態を更新できます。'),
  ).toBeVisible();
  await page.getByRole('link', { name: '演習を再開する', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '演習が完了しました' }),
  ).toBeVisible();
  await page.goto('/history');
  await expect(
    page.getByRole('list', { name: '履歴一覧' }).getByRole('listitem'),
  ).toHaveCount(2);
});

test('history retry keeps cursor, forbidden clears rows, result denies another owner', async ({
  page,
}) => {
  const f = await seedHistory(21);
  await page.goto('/history');
  const list = page.getByRole('list', { name: '履歴一覧' });
  await expect(list.getByRole('listitem')).toHaveCount(20);
  const before: string[] = [];
  await page.route('**/api/sessions?*', (route) => {
    before.push(
      new URL(route.request().url()).searchParams.get('before') ?? '',
    );
    return route.fulfill({ status: 500, body: '{}' });
  });
  await page.getByRole('button', { name: '履歴をもっと見る' }).click();
  await page.getByRole('button', { name: '履歴を再試行' }).click();
  expect(before).toHaveLength(2);
  expect(before[0]).toBe(before[1]);
  await expect(list.getByRole('listitem')).toHaveCount(20);
  await page.unroute('**/api/sessions?*');
  await page.getByRole('button', { name: '履歴を再試行' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(23);
  await page.route('**/api/sessions?*', (route) =>
    route.fulfill({ status: 403, body: '{}' }),
  );
  await page.getByRole('button', { name: '履歴を更新する' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'この環境では演習を利用できません',
  );
  await expect(list).toHaveCount(0);
  await page.goto(`/sessions/${f.other}/result`);
  await expect(page.getByRole('alert')).toContainText(
    'この演習または問題を表示できません',
  );
  await expect(page.getByRole('list', { name: '各問の振り返り' })).toHaveCount(
    0,
  );
});

test('failed refresh retries the first page and replaces stale data; result 403 clears feedback', async ({
  page,
}) => {
  const f = await seedHistory(21);
  await page.goto('/history');
  const list = page.getByRole('list', { name: '履歴一覧' });
  await expect(list.getByRole('listitem')).toHaveCount(20);
  sql("update question_sets set title='更新後タイトル'");
  const cursors: (string | null)[] = [];
  let fail = true;
  await page.route('**/api/sessions?*', async (route) => {
    cursors.push(new URL(route.request().url()).searchParams.get('before'));
    if (fail) return route.fulfill({ status: 500, body: '{}' });
    return route.continue();
  });
  await page.getByRole('button', { name: '履歴を更新する' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: '履歴を再試行' }).click();
  await expect(
    list.getByRole('heading', { name: '更新後タイトル', exact: true }),
  ).toHaveCount(20);
  expect(cursors).toEqual([null, null]);
  await page.goto(`/sessions/${f.completed}/result`);
  await expect(
    page.getByRole('heading', { name: 'AI解説', exact: true }),
  ).toHaveCount(3);
  await page.route(`**/api/sessions/${f.completed}`, (route) =>
    route.fulfill({ status: 403, body: '{}' }),
  );
  await page.getByRole('button', { name: '結果を更新する' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'この環境では演習を利用できません',
  );
  await expect(page.getByRole('list', { name: '各問の振り返り' })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('button', { name: '誤答を復習する' }),
  ).toHaveCount(0);
});
