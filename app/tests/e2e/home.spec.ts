import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { emptyCatalog } from './fixtures/catalog-db';
test.beforeEach(() => emptyCatalog());

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
    page.getByRole('heading', { name: '過去問で学ぶ', exact: true }),
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

test('development exercise preview is absent in production', async ({
  request,
}) => {
  const response = await request.get('/dev/study-preview');
  expect(response.status()).toBe(404);
  expect(await response.text()).not.toContain(
    'MEDIQUEST_DEVELOPMENT_STUDY_FIXTURE_ONLY',
  );
});

test('production output excludes the fixed preview question text', () => {
  const fixtures = [
    'この練習画面で、回答を確定する操作はどれですか？',
    'この練習画面の操作について、正しいものを2つ選んでください。',
  ];
  function inspect(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (/\.(m?js|html|json|map)$/.test(entry.name)) {
        const content = readFileSync(path, 'utf8').replace(
          /\\u([0-9a-f]{4})/gi,
          (_, hex: string) => String.fromCharCode(parseInt(hex, 16)),
        );
        for (const fixture of fixtures)
          expect(content, path).not.toContain(fixture);
      }
    }
  }
  inspect('.output/public');
  inspect('.output/server');
});

test('production excludes test transport and browser generation secrets', () => {
  function inspect(directory: string, browser: boolean) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) inspect(path, browser);
      else if (/\.(m?js|json|html|map)$/.test(entry.name)) {
        const content = readFileSync(path, 'utf8');
        for (const marker of [
          'TEST_ONLY_GENERATION_TRANSPORT_MARKER',
          'TEST_GENERATION_EVENTS',
          'SCENARIO_PENDING',
        ])
          expect(content, path).not.toContain(marker);
        if (browser)
          for (const marker of [
            'ANTHROPIC_API_KEY',
            'api.anthropic.com/v1/messages',
          ])
            expect(content, path).not.toContain(marker);
      }
    }
  }
  inspect('.output/public', true);
  inspect('.output/server', false);
});
