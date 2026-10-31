import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFileSync } from 'node:fs';
import { emptyCatalog, database } from './fixtures/catalog-db';
test.beforeEach(() => emptyCatalog());
async function openForm(page: Page) {
  await page.goto('/admin/sources/new');
  await page.getByLabel('タイトル', { exact: true }).fill('手入力教材');
  await page
    .getByLabel('教材本文', { exact: true })
    .fill('水は通常、摂氏100度で沸騰します。');
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await page
    .getByRole('link', { name: '手動で問題を登録する', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: '手動で問題を登録', exact: true }),
  ).toBeVisible();
}
async function fill(page: Page) {
  await page.getByLabel('セット名', { exact: true }).fill('手入力セット');
  await page
    .getByLabel('問題文', { exact: true })
    .fill('通常、水が沸騰する温度は？');
  await page.getByLabel('選択肢 1', { exact: true }).fill('100度');
  await page.getByLabel('選択肢 2', { exact: true }).fill('20度');
  await page.getByLabel('選択肢 1 を正答にする', { exact: true }).check();
  await page
    .getByLabel('解説', { exact: true })
    .fill('教材に100度と記載されています。');
  await page
    .getByLabel('教材からの引用', { exact: true })
    .fill('水は通常、摂氏100度で沸騰します。');
}
function counts() {
  const c = database();
  try {
    return {
      runs: c.client.prepare('select count(*) n from generation_runs').get(),
      sets: c.client.prepare('select count(*) n from question_sets').get(),
      manual: c.client
        .prepare(
          'select count(*) n from question_versions where manual_created_by=1',
        )
        .get(),
    };
  } finally {
    c.close();
  }
}
async function evidence(page: Page, info: TestInfo, name: string) {
  for (const theme of ['ライト', 'ダーク']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    if (theme === 'ダーク')
      await expect(page.locator('html')).toHaveClass(/dark/);
    else await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.screenshot({
      path: info.outputPath(`${name}-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    writeFileSync(
      info.outputPath(`${name}-${theme}-accessibility.json`),
      JSON.stringify(result),
    );
    expect(result.violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
}
test('manual authoring without AI configuration reaches published study', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let generations = 0;
  page.on('request', (request) => {
    if (request.url().includes('/generations')) generations++;
  });
  await openForm(page);
  await evidence(page, info, 'manual-empty');
  await page.getByLabel('セット名', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('問題文', { exact: true })).toBeFocused();
  await fill(page);
  await evidence(page, info, 'manual-filled');
  await page
    .getByRole('button', { name: '下書きを保存して確認へ', exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/sets\/\d+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1);
  await expect(
    page.getByText('手動登録した問題', { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('問題・選択肢・正答・解説・引用の内容を確認しました', {
      exact: true,
    })
    .check();
  await page
    .getByRole('button', { name: '候補 1 の確認を記録', exact: true })
    .click();
  await expect(page.getByText('確認済み', { exact: true })).toBeVisible();
  await page.getByLabel('候補 1 を採用する', { exact: true }).check();
  await page
    .getByRole('button', { name: '採用と順序を保存', exact: true })
    .click();
  await page
    .getByLabel('採用した内容・順序と公開範囲を確認して公開します', {
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: '公開する', exact: true }).click();
  await expect(
    page.getByText('セットを公開しました。', { exact: true }),
  ).toBeVisible();
  expect(counts()).toEqual({
    runs: { n: 0 },
    sets: { n: 1 },
    manual: { n: 1 },
  });
  expect(generations).toBe(0);
  await page.goto(`/sets/${id}`);
  await expect(page.getByText('出題可能: 1問', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '演習を始める', exact: true }).click();
  await page.getByRole('radio', { name: '100度', exact: true }).check();
  await page.getByRole('button', { name: '回答する', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '✓ 正解です', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByRole('link', { name: '結果を見る', exact: true }).click();
  await expect(page.getByText('1 / 1問', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('validation retains input and lost response replays the same manual set', async ({
  page,
}) => {
  await openForm(page);
  await page
    .getByRole('button', { name: '下書きを保存して確認へ', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('問題 1 を確認');
  await fill(page);
  await page
    .getByRole('button', { name: '問題を追加（1 / 10問）', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: '問題 2', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '問題 2 を削除', exact: true })
    .click();
  await page.getByRole('button', { name: '選択肢を追加', exact: true }).click();
  await page.getByLabel('選択肢 3', { exact: true }).fill('別の正答');
  await page.getByLabel('選択肢 3 を正答にする', { exact: true }).check();
  await page
    .getByRole('button', { name: '選択肢 3 を削除', exact: true })
    .click();
  let key = '';
  await page.route('**/manual-sets', async (route) => {
    key = route.request().headers()['idempotency-key']!;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort();
  });
  await page
    .getByRole('button', { name: '下書きを保存して確認へ', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('入力は保持しています');
  await expect(page.getByLabel('問題文', { exact: true })).toHaveValue(
    '通常、水が沸騰する温度は？',
  );
  await expect(page.getByLabel('問題文', { exact: true })).toBeDisabled();
  await page.unroute('**/manual-sets');
  await page.route('**/manual-sets', async (route) => {
    expect(route.request().headers()['idempotency-key']).toBe(key);
    await route.continue();
  });
  await page
    .getByRole('button', { name: '同じ内容で保存結果を確認', exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/sets\/\d+$/);
  expect(counts()).toEqual({
    runs: { n: 0 },
    sets: { n: 1 },
    manual: { n: 1 },
  });
});
test('manual save forbidden clears sensitive inputs', async ({ page }) => {
  await openForm(page);
  await fill(page);
  await page.route('**/manual-sets', (route) =>
    route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }),
  );
  await page
    .getByRole('button', { name: '下書きを保存して確認へ', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    '管理者としてこの操作を利用できません',
  );
  await expect(page.getByLabel('問題文', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('水は通常、摂氏100度で沸騰します。', { exact: true }),
  ).toHaveCount(0);
  expect(counts()).toEqual({
    runs: { n: 0 },
    sets: { n: 0 },
    manual: { n: 0 },
  });
});
