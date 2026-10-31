import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { database, emptyCatalog } from '../e2e/fixtures/catalog-db';
test.beforeEach(() => emptyCatalog());
const input = {
  examName: '修正確認試験',
  year: '2025',
  subject: '情報',
  confirmed: true,
  questions: [
    {
      questionNumber: '1',
      body: '元の問題',
      choices: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      answerIds: ['a'],
      explanation: '',
    },
  ],
};
async function create(request: APIRequestContext) {
  const response = await request.post('/api/admin/past-exams', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: input,
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).setId as number;
}
test('stale edit retains input and points to the latest registered edition', async ({
  page,
  request,
}) => {
  const id = await create(request);
  await page.goto(`/admin/past-exams/${id}`);
  await page.getByLabel('問題文', { exact: true }).fill('保持する修正');
  const response = await request.post(`/api/admin/past-exams/${id}/revisions`, {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { ...input, revision: 0 },
  });
  expect(response.ok()).toBe(true);
  await page.getByLabel('問題文・選択肢・正答を確認しました').check();
  await page
    .getByRole('button', { name: '修正を保存する', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('競合');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '入力内容をファイルに保存' }).click();
  expect((await downloaded).suggestedFilename()).toBe(
    'mediquest-past-exam-input.json',
  );
  await page.getByText('コピー用の入力内容を表示', { exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: '競合した入力内容（コピー用）' }),
  ).toHaveValue(/保持する修正/);
  await expect(page.getByLabel('問題文', { exact: true })).toHaveValue(
    '保持する修正',
  );
  await page
    .getByRole('link', { name: '登録済みの過去問を見る', exact: true })
    .click();
  await expect(page.getByRole('listitem')).toHaveCount(1);
});
test('unknown revision response replays one edition and denies private content on 403', async ({
  page,
  request,
}) => {
  const id = await create(request);
  await page.goto(`/admin/past-exams/${id}`);
  await page.getByLabel('問題文', { exact: true }).fill('修正した問題');
  await page.getByLabel('問題文・選択肢・正答を確認しました').check();
  let key = '';
  await page.route('**/revisions', async (route) => {
    key = route.request().headers()['idempotency-key']!;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort();
  });
  await page
    .getByRole('button', { name: '修正を保存する', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('入力は保持');
  await page.unroute('**/revisions');
  await page.route('**/revisions', async (route) => {
    expect(route.request().headers()['idempotency-key']).toBe(key);
    await route.continue();
  });
  await page.getByRole('button', { name: '同じ内容で保存結果を確認' }).click();
  await expect(page).not.toHaveURL(new RegExp(`/admin/past-exams/${id}$`));
  await expect(page.getByLabel('問題文', { exact: true })).toHaveValue(
    '修正した問題',
  );
  const c = database();
  try {
    expect(c.client.prepare('select count(*) n from past_exams').get()).toEqual(
      { n: 2 },
    );
  } finally {
    c.close();
  }
  await page.route('**/api/admin/past-exams/*', (route) =>
    route.fulfill({ status: 403, body: '{}' }),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('問題文', { exact: true })).toHaveCount(0);
});
test('multiple correct answers and six choices survive editing and registration', async ({
  page,
  request,
}) => {
  const id = await create(request);
  await page.goto(`/admin/past-exams/${id}`);
  for (let n = 3; n <= 6; n++) {
    await page
      .getByRole('button', { name: '選択肢を追加', exact: true })
      .click();
    await page.getByLabel(`選択肢 ${n}`, { exact: true }).fill(`選択肢${n}`);
  }
  await page.getByLabel('選択肢 6 を正答にする', { exact: true }).check();
  await page.getByLabel('問題文・選択肢・正答を確認しました').check();
  await page
    .getByRole('button', { name: '修正を保存する', exact: true })
    .click();
  await expect(page).not.toHaveURL(new RegExp(`/admin/past-exams/${id}$`));
  await expect(
    page.getByLabel('選択肢 6 を正答にする', { exact: true }),
  ).toBeChecked();
  await page.getByRole('link', { name: 'この過去問を解く' }).click();
  await page.getByRole('button', { name: '演習を始める', exact: true }).click();
  await page.getByRole('checkbox', { name: 'A', exact: true }).check();
  await page.getByRole('checkbox', { name: '選択肢6', exact: true }).check();
  await page.getByRole('button', { name: '回答する', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '✓ 正解です', exact: true }),
  ).toBeVisible();
});
