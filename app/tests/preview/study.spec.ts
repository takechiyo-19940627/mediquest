import { expect, test } from '@playwright/test';

for (const theme of ['ライト', 'ダーク']) {
  test(`exercise preview in ${theme}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/dev/study-preview');
    await page.getByRole('button', { name: theme, exact: true }).click();
    await expect(page.locator('html')).toHaveClass(
      theme === 'ライト' ? /light/ : /dark/,
    );
    await expect(
      page.getByText('操作確認用・記録は保存されません', { exact: true }),
    ).toBeVisible();
    const confirm = page.getByRole('button', { name: '回答する', exact: true });
    await expect(confirm).toBeDisabled();
    // Start at the last theme control and use normal keyboard navigation into the question.
    await page.getByRole('button', { name: 'ダーク', exact: true }).focus();
    await page.keyboard.press('Tab');
    const firstChoice = page.getByRole('radio').first();
    await expect(firstChoice).toBeFocused();
    expect(
      await firstChoice.evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
        );
      }),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`${theme}-focus.png`),
      fullPage: true,
    });
    await page.keyboard.press('ArrowDown');
    await expect(
      page.getByRole('radio', { name: '選択後に「回答する」を押す' }),
    ).toBeFocused();
    await page.keyboard.press('Space');
    await page.getByText('保存失敗の動作確認', { exact: true }).click();
    await page
      .getByRole('checkbox', { name: '次の模擬保存を1回だけ失敗させる' })
      .check();
    await confirm.click();
    await expect(page.getByRole('status')).toContainText('模擬保存中');
    await expect(page.getByRole('status')).toContainText('模擬保存に失敗');
    await expect(
      page.getByRole('button', { name: '次へ', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: '保存を再試行する' }).click();
    await expect(
      page.getByRole('heading', { name: '✓ 正解です' }),
    ).toBeVisible();
    await expect(page.getByRole('radio').first()).toBeDisabled();
    await expect(
      page.getByRole('heading', { name: 'AI解説（デモ）' }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`${theme}-feedback.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: '次へ', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '演習画面のプレビュー' }),
    ).toBeFocused();
    await page
      .getByRole('checkbox', { name: '保存失敗時は選択が保持される' })
      .check();
    await expect(confirm).toBeDisabled();
    await page
      .getByRole('checkbox', { name: '保存完了後は自動で次の問題に進む' })
      .check();
    await expect(
      page.getByRole('checkbox', { name: '「次へ」を押して次の問題に進む' }),
    ).toBeDisabled();
    await confirm.click();
    await expect(
      page.getByRole('heading', { name: '！不正解です' }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`${theme}-multiple.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
