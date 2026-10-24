import { expect, test } from '@playwright/test';

test('home, keyboard theme changes, persistence and responsive layout', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || /hydration/i.test(message.text()))
      errors.push(message.text());
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '学習ホーム', exact: true }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);
  for (const [label, theme] of [
    ['ライト', 'light'],
    ['ダーク', 'dark'],
  ] as const) {
    const control = page.getByRole('button', { name: label, exact: true });
    await control.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveClass(new RegExp(theme));
    await page.screenshot({
      path: testInfo.outputPath(`${theme}.png`),
      fullPage: true,
    });
    await page.reload();
    await expect(page.locator('html')).toHaveClass(new RegExp(theme));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole('heading', { name: '学習できる問題はまだありません' }),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: 'システム', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveClass(/light/);
  expect(errors).toEqual([]);
});
