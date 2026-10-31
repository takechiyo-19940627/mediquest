// Past-exam registration replaces the retired source/manual-draft UI.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { database, emptyCatalog } from './fixtures/catalog-db';
test.beforeEach(() => emptyCatalog());
async function fill(page: Page) {
  await page.goto('/admin/past-exams/new');
  await page.getByLabel('試験名', { exact: true }).fill('検定試験');
  await page.getByLabel('年度', { exact: true }).fill('2025');
  await page.getByLabel('科目', { exact: true }).fill('情報');
  await page.getByLabel('問題番号', { exact: true }).fill('12');
  await page
    .getByLabel('問題文', { exact: true })
    .fill('正しい選択肢を選んでください。');
  await page.getByLabel('選択肢 1', { exact: true }).fill('正答の選択肢');
  await page.getByLabel('選択肢 2', { exact: true }).fill('誤答の選択肢');
  await page.getByLabel('選択肢 1 を正答にする', { exact: true }).check();
  await page.getByLabel('問題文・選択肢・正答を確認しました').check();
}
function counts() {
  const c = database();
  try {
    return c.client
      .prepare(
        'select (select count(*) from past_exams) papers,(select count(*) from generation_runs) runs',
      )
      .get();
  } finally {
    c.close();
  }
}
test('registers without AI or source, studies, revises and preserves historical answers', async ({
  page,
  request,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fill(page);
  for (const theme of ['ライト', 'ダーク']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.screenshot({
      path: info.outputPath(`past-form-${theme}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page
    .getByRole('button', { name: '過去問を登録する', exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/past-exams\/\d+$/);
  const id = Number(new URL(page.url()).pathname.split('/').pop());
  await expect(page.getByLabel('問題文', { exact: true })).toHaveValue(
    '正しい選択肢を選んでください。',
  );
  expect(counts()).toEqual({ papers: 1, runs: 0 });
  const publicResponse = await request.get(`/api/past-exams/${id}`);
  expect(await publicResponse.text()).not.toMatch(/answerIds|正答の選択肢/);
  await page.getByRole('link', { name: 'この過去問を解く' }).click();
  await page.getByRole('button', { name: '演習を始める', exact: true }).click();
  const sessionPath = new URL(page.url()).pathname;
  await page.getByRole('radio', { name: '誤答の選択肢', exact: true }).check();
  await page.getByRole('button', { name: '回答する', exact: true }).click();
  await expect(page.getByText('解説はまだ登録されていません。')).toBeVisible();
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByRole('link', { name: '結果を見る', exact: true }).click();
  await page.goto(`/admin/past-exams/${id}`);
  await page.getByLabel('問題文', { exact: true }).fill('修正した問題文');
  await page
    .getByLabel('解説（任意）', { exact: true })
    .fill('後から追加した解説');
  await page.getByLabel('問題文・選択肢・正答を確認しました').check();
  await page
    .getByRole('button', { name: '修正を保存する', exact: true })
    .click();
  await expect(page).not.toHaveURL(new RegExp(`/admin/past-exams/${id}$`));
  await expect(page.getByLabel('問題文', { exact: true })).toHaveValue(
    '修正した問題文',
  );
  await page.goto(`${sessionPath}/result`);
  await expect(
    page.getByText('正しい選択肢を選んでください。', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('修正した問題文', { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: '誤答を復習する' }).click();
  await expect(
    page.getByText('正しい選択肢を選んでください。', { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test('validation and lost response retain input and replay one receipt', async ({
  page,
}) => {
  await fill(page);
  await page.getByLabel('問題文', { exact: true }).fill('');
  await page
    .getByRole('button', { name: '過去問を登録する', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('問題 1 を確認');
  await page.getByLabel('問題文', { exact: true }).fill('保持する問題文');
  let key = '';
  await page.route('**/api/admin/past-exams', async (route) => {
    key = route.request().headers()['idempotency-key']!;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort();
  });
  await page
    .getByRole('button', { name: '過去問を登録する', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('入力は保持しています');
  await expect(page.getByLabel('問題文', { exact: true })).toHaveValue(
    '保持する問題文',
  );
  await expect(page.getByLabel('問題文', { exact: true })).toBeDisabled();
  await page.unroute('**/api/admin/past-exams');
  await page.route('**/api/admin/past-exams', async (route) => {
    expect(route.request().headers()['idempotency-key']).toBe(key);
    await route.continue();
  });
  await page
    .getByRole('button', { name: '同じ内容で保存結果を確認', exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/past-exams\/\d+$/);
  expect(counts()).toEqual({ papers: 1, runs: 0 });
});
test('forbidden save removes entered private content', async ({ page }) => {
  await fill(page);
  await page.route('**/api/admin/past-exams', (route) =>
    route.fulfill({ status: 403, body: '{}' }),
  );
  await page
    .getByRole('button', { name: '過去問を登録する', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    '管理者としてこの操作を利用できません',
  );
  await expect(page.getByLabel('問題文', { exact: true })).toHaveCount(0);
  expect(counts()).toEqual({ papers: 0, runs: 0 });
});
