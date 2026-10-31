import { writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { emptyCatalog } from '../e2e/fixtures/catalog-db';

test.beforeEach(() => emptyCatalog());

async function theme(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  if (label === 'ダーク')
    await expect(page.locator('html')).toHaveClass(/dark/);
  else await expect(page.locator('html')).not.toHaveClass(/dark/);
}
async function capture(page: Page, info: TestInfo, name: string) {
  // Playwright fast-forwards finite dialog transitions before measuring colors.
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const path = info.outputPath(`${name}-accessibility.json`);
  writeFileSync(path, JSON.stringify(result, null, 2));
  await info.attach(`${name}-accessibility`, {
    path,
    contentType: 'application/json',
  });
  expect.soft(result.violations, name).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function evidence(page: Page, info: TestInfo, name: string) {
  for (const label of ['ライト', 'ダーク']) {
    await theme(page, label);
    await capture(page, info, `${name}-${label}`);
  }
}

async function answer(page: Page, label: string) {
  await page.getByRole('radio', { name: label, exact: true }).check();
  await page.getByRole('button', { name: '回答する', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '次へ', exact: true }),
  ).toBeVisible();
}

test('complete local release journey uses real APIs and preserves historical answers', async ({
  page,
  request,
}, info) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await evidence(page, info, 'empty-home');
  await page
    .getByRole('link', { name: '過去問を登録・管理', exact: true })
    .click();
  await evidence(page, info, 'past-exam-list');
  await page
    .getByRole('link', { name: '新しい過去問を登録', exact: true })
    .click();
  await evidence(page, info, 'past-exam-form');
  await page.getByLabel('試験名', { exact: true }).fill('受入確認試験');
  await page.getByLabel('年度', { exact: true }).fill('2025');
  await page.getByLabel('科目', { exact: true }).fill('情報');
  for (let index = 1; index <= 3; index++) {
    if (index > 1)
      await page.getByRole('button', { name: /問題を追加/ }).click();
    const region = page.getByRole('region', {
      name: `問題 ${index}`,
      exact: true,
    });
    await region
      .getByLabel('問題文', { exact: true })
      .fill(`受入確認問題${index}`);
    await region.getByLabel('選択肢 1', { exact: true }).fill('選択肢A');
    await region.getByLabel('選択肢 2', { exact: true }).fill('選択肢B');
    await region.getByLabel('選択肢 1 を正答にする', { exact: true }).check();
  }
  await page.getByLabel('問題文・選択肢・正答を確認しました').check();
  await page
    .getByRole('button', { name: '過去問を登録する', exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/past-exams\/\d+$/);
  const setId = Number(new URL(page.url()).pathname.split('/').at(-1));
  await expect(page.getByLabel('試験名', { exact: true })).toHaveValue(
    '受入確認試験',
  );
  await evidence(page, info, 'past-exam-edit');
  await page.goto('/');
  await page.getByRole('link', { name: /受入確認試験.*の詳細を見る/ }).click();
  await evidence(page, info, 'set-detail');
  await page.getByRole('button', { name: '演習を始める', exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/\d+$/);
  const sessionId = Number(new URL(page.url()).pathname.split('/').at(-1));
  await evidence(page, info, 'question');
  await answer(page, '選択肢B');
  await evidence(page, info, 'feedback');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page
    .getByRole('link', { name: '中断してホームへ', exact: true })
    .click();
  await page.locator(`a[href="/sessions/${sessionId}"]`).first().click();
  await page
    .getByRole('button', { name: 'この問題をスキップ', exact: true })
    .click();
  await expect(
    page.getByText(
      'スキップしました。未回答のまま保持され、通常の未回答の後に戻ります。',
      { exact: true },
    ),
  ).toBeVisible();
  await answer(page, '選択肢A');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await answer(page, '選択肢A');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByRole('link', { name: '結果を見る', exact: true }).click();
  await expect(page.getByText('2 / 3問', { exact: true })).toBeVisible();
  await evidence(page, info, 'result');
  const before = await (await request.get(`/api/sessions/${sessionId}`)).json();
  await page
    .getByRole('button', { name: '誤答を復習する', exact: true })
    .click();
  await expect(page).toHaveURL(/\/sessions\/\d+$/);
  const reviewId = Number(new URL(page.url()).pathname.split('/').at(-1));
  expect(reviewId).not.toBe(sessionId);
  await answer(page, '選択肢A');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.goto('/history');
  await evidence(page, info, 'history');

  await page.goto(`/sessions/${sessionId}/result`);
  for (const label of ['ライト', 'ダーク']) {
    await theme(page, label);
    await page
      .getByRole('button', { name: 'この問題の不備を報告', exact: true })
      .first()
      .click();
    await page
      .getByRole('textbox', { name: '不備の理由' })
      .fill('教材との対応を管理者に確認してほしい');
    await capture(page, info, `report-dialog-${label}`);
    if (label === 'ダーク') {
      await page
        .getByRole('button', { name: '報告を送信する', exact: true })
        .click();
      await expect(
        page.getByText('報告を受け付けました。', { exact: false }),
      ).toBeVisible();
    }
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
  }
  await page.goto('/admin/reports');
  await evidence(page, info, 'report-list');
  await page.getByRole('link', { name: /報告 #/ }).click();
  await evidence(page, info, 'report-decision');
  await page.getByLabel('判断', { exact: true }).selectOption('dismissed');
  await page
    .getByRole('textbox', { name: '判断の理由' })
    .fill('教材と照合し現在の内容で問題ないと確認しました');
  await page
    .getByRole('button', { name: 'この判断を確定する', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: /報告 #.*問題なし/ }),
  ).toBeVisible();
  await page.goto('/admin/past-exams');
  await evidence(page, info, 'registered-list');
  await page.goto(`/admin/past-exams/${setId}`);
  await page
    .getByRole('region', { name: '問題 1', exact: true })
    .getByLabel('問題文', { exact: true })
    .fill('改訂した受入確認問題');
  await page.getByLabel('問題文・選択肢・正答を確認しました').check();
  await page
    .getByRole('button', { name: '修正を保存する', exact: true })
    .click();
  await expect(page).not.toHaveURL(new RegExp(`/admin/past-exams/${setId}$`));
  const revisionId = Number(new URL(page.url()).pathname.split('/').at(-1));
  expect((await request.get(`/api/sets/${setId}`)).status()).toBe(404);
  expect((await request.get(`/api/sets/${revisionId}`)).status()).toBe(200);
  const after = await (await request.get(`/api/sessions/${sessionId}`)).json();
  expect(after).toEqual(before);
  await page.goto(`/sessions/${sessionId}/result`);
  await expect(page.getByText('2 / 3問', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /改訂した受入確認問題/ }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
