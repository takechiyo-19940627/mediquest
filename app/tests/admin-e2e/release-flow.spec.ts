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

function candidate(page: Page, index: number) {
  return page.getByRole('region', { name: `候補 ${index}`, exact: true });
}
async function confirm(page: Page, index: number) {
  const region = candidate(page, index);
  await region
    .getByLabel('問題・選択肢・正答・解説・引用の内容を確認しました', {
      exact: true,
    })
    .check();
  await region
    .getByRole('button', { name: `候補 ${index} の確認を記録`, exact: true })
    .click();
  await expect(region.getByText('確認済み', { exact: true })).toBeVisible();
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
    .getByRole('link', { name: '教材管理（管理者用）', exact: true })
    .click();
  await evidence(page, info, 'source-list');
  await page.goto('/admin/sources/new');
  await evidence(page, info, 'source-form');
  await page.getByLabel('タイトル', { exact: true }).fill('受入確認用教材');
  await page.getByLabel('教材本文', { exact: true }).fill('教材の根拠です。');
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/sources\/\d+$/);
  await page.getByLabel('セット名', { exact: true }).fill('受入確認セット');
  await page.getByLabel('問数', { exact: true }).fill('3');
  await page.getByRole('button', { name: '生成する', exact: true }).click();
  await expect(
    page.getByText('生成が完了しました', { exact: true }),
  ).toBeVisible();
  await evidence(page, info, 'generation');
  await page.locator('a[href^="/admin/sets/"]').click();
  await expect(
    page.getByRole('heading', { name: '受入確認セット', exact: true }),
  ).toBeVisible();
  const setId = Number(new URL(page.url()).pathname.split('/').at(-1));
  await evidence(page, info, 'draft-set');
  for (let index = 1; index <= 3; index++) {
    await confirm(page, index);
  }
  for (let index = 1; index <= 3; index++) {
    await candidate(page, index)
      .getByLabel(`候補 ${index} を採用する`, { exact: true })
      .check();
  }
  await page
    .getByRole('button', { name: '採用と順序を保存', exact: true })
    .click();
  await publish(page);
  await page.goto('/');
  await page.getByRole('link', { name: /受入確認セット/ }).click();
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
  await page.goto('/admin/sets');
  await evidence(page, info, 'set-list');

  await page.goto(`/admin/sets/${setId}`);
  await page
    .getByLabel('改訂セット名', { exact: true })
    .fill('受入確認セット改訂版');
  await page
    .getByLabel('元の公開内容と過去回答を保持して改訂下書きを作成します', {
      exact: true,
    })
    .check();
  await page
    .getByRole('button', { name: '改訂下書きを作成する', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: '受入確認セット改訂版', exact: true }),
  ).toBeVisible();
  const revisionId = Number(new URL(page.url()).pathname.split('/').at(-1));
  await candidate(page, 1)
    .getByRole('button', { name: '候補 1 の内容を編集', exact: true })
    .click();
  await candidate(page, 1)
    .getByLabel('問題文', { exact: true })
    .fill('改訂した受入確認問題');
  await candidate(page, 1)
    .getByRole('button', { name: '内容を保存', exact: true })
    .click();
  // Editing a shared version creates a new version ID; candidate order can change.
  const edited = page
    .getByRole('region')
    .filter({ has: page.getByText('改訂した受入確認問題', { exact: true }) });
  await edited
    .getByLabel('問題・選択肢・正答・解説・引用の内容を確認しました', {
      exact: true,
    })
    .check();
  await edited.getByRole('button', { name: /の確認を記録$/ }).click();
  await expect(edited.getByText('確認済み', { exact: true })).toBeVisible();
  await publish(page, true);
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
