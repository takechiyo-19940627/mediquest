// The original authoring UI is retired by the past-exams-first release.
// Its API/storage regression suites remain in tests/integration.
import { expect, test } from '@playwright/test';
import { emptyCatalog } from '../e2e/fixtures/catalog-db';
test.beforeEach(() => emptyCatalog());
test('all old authoring URLs lead to past exam management without legacy forms', async ({
  page,
}) => {
  for (const path of [
    '/admin/sources',
    '/admin/sources/new',
    '/admin/sources/1',
    '/admin/sets',
    '/admin/sets/1',
    '/admin/manual-sets/new?sourceId=1',
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/past-exams$/);
    await expect(
      page.getByRole('heading', { name: '過去問の管理', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: '新しい過去問を登録', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('AIで問題を生成', { exact: true })).toHaveCount(
      0,
    );
  }
});
test('empty list, explicit retry and forbidden response do not expose private data', async ({
  page,
  request,
}) => {
  await page.goto('/admin/past-exams');
  await expect(
    page.getByRole('heading', { name: 'まずは1問、登録してみましょう' }),
  ).toBeVisible();
  const html = await (await request.get('/admin/past-exams')).text();
  expect(html).not.toContain('answerIds');
  await page.route('**/api/admin/past-exams*', (route) =>
    route.fulfill({ status: 500, body: 'SECRET_STACK' }),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await page.content()).not.toContain('SECRET_STACK');
  await page.unroute('**/api/admin/past-exams*');
  await page.getByRole('button', { name: '再試行', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.route('**/api/admin/past-exams*', (route) =>
    route.fulfill({ status: 403, body: '{}' }),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(0);
});
