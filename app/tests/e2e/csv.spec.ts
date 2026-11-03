import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { database, emptyCatalog } from './fixtures/catalog-db';

test.beforeEach(() => emptyCatalog());
function paperCount() {
  const db = database();
  try {
    return (
      db.client.prepare('select count(*) n from past_exams').get() as {
        n: number;
      }
    ).n;
  } finally {
    db.close();
  }
}
test('CSV template, validation, confirmation, export and fresh import preserve content', async ({
  page,
}, info) => {
  await page.goto('/admin/past-exams/new');
  const templateEvent = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'CSVテンプレートをダウンロード' })
    .click();
  const template = await readFile(
    (await (await templateEvent).path()) as string,
  );
  await page.getByLabel('試験名', { exact: true }).fill('入力を保持');
  await page.getByLabel('過去問CSVファイル').setInputFiles({
    name: 'bad.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('bad\nrow'),
  });
  await expect(page.getByRole('alert')).toContainText(
    '入力中の内容は変更していません',
  );
  await expect(page.getByLabel('試験名', { exact: true })).toHaveValue(
    '入力を保持',
  );
  await page.getByLabel('過去問CSVファイル').setInputFiles({
    name: 'template.csv',
    mimeType: 'text/csv',
    buffer: template,
  });
  const apply = page.getByRole('button', { name: 'CSVの内容をフォームに反映' });
  await expect(apply).toBeVisible();
  await expect(page.getByLabel('試験名', { exact: true })).toHaveValue(
    '入力を保持',
  );
  await apply.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('status').filter({ hasText: 'まだ登録されていません' }),
  ).toBeVisible();
  expect(paperCount()).toBe(0);
  await expect(
    page.getByLabel('問題文・選択肢・正答を確認しました'),
  ).not.toBeChecked();
  await page
    .getByRole('button', { name: '過去問を登録する', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('確認にチェック');
  expect(paperCount()).toBe(0);
  const body = '=危険な数式ではなく問題文, "引用"\n日本語の2行目';
  await page.getByLabel('問題文', { exact: true }).fill(body);
  await page.getByLabel('選択肢 2 を正答にする', { exact: true }).check();
  await page
    .getByLabel('解説（任意）', { exact: true })
    .fill('複数正答の解説\n続き');
  for (const theme of ['ライト', 'ダーク']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.screenshot({
      path: info.outputPath(`csv-form-${theme}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await page.getByLabel('問題文・選択肢・正答を確認しました').check();
  await page
    .getByRole('button', { name: '過去問を登録する', exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/past-exams\/\d+$/);
  const firstUrl = page.url();
  const exportEvent = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'CSVをエクスポート', exact: true })
    .click();
  const exported = await readFile((await (await exportEvent).path()) as string);
  expect(exported.toString('utf8')).toContain("'=危険な数式");
  await page.goto('/admin/past-exams/new');
  await page.getByLabel('過去問CSVファイル').setInputFiles({
    name: 'export.csv',
    mimeType: 'text/csv',
    buffer: exported,
  });
  await page.getByRole('button', { name: 'CSVの内容をフォームに反映' }).click();
  await expect(page.getByLabel('問題文', { exact: true })).toHaveValue(body);
  await expect(
    page.getByLabel('選択肢 1 を正答にする', { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByLabel('選択肢 2 を正答にする', { exact: true }),
  ).toBeChecked();
  expect(paperCount()).toBe(1);
  await page.getByLabel('問題文・選択肢・正答を確認しました').check();
  await page
    .getByRole('button', { name: '過去問を登録する', exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/past-exams\/\d+$/);
  expect(page.url()).not.toBe(firstUrl);
  expect(paperCount()).toBe(2);
});

test('export failure is visible and retry succeeds', async ({ page }) => {
  await page.goto('/admin/past-exams/new');
  const event = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'CSVテンプレートをダウンロード' })
    .click();
  const buffer = await readFile((await (await event).path()) as string);
  await page
    .getByLabel('過去問CSVファイル')
    .setInputFiles({ name: 'sample.csv', mimeType: 'text/csv', buffer });
  await page.getByRole('button', { name: 'CSVの内容をフォームに反映' }).click();
  await page.getByLabel('問題文・選択肢・正答を確認しました').check();
  await page
    .getByRole('button', { name: '過去問を登録する', exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/past-exams\/\d+$/);
  await page.route('**/api/admin/past-exams/*/csv', (route) =>
    route.fulfill({ status: 503, body: '{}' }),
  );
  await page
    .getByRole('button', { name: 'CSVをエクスポート', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'CSVを書き出せませんでした',
  );
  await page.unroute('**/api/admin/past-exams/*/csv');
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'CSVをエクスポート', exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(
    /mediquest-past-exam-\d+\.csv/,
  );
});
