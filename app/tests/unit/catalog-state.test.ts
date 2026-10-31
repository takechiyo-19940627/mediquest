import { expect, it } from 'vitest';
import {
  appendCatalog,
  catalogError,
  validCatalogId,
} from '../../app/utils/catalog-state';
const item = (id: number) => ({
  id,
  title: '題名',
  description: '',
  publishedAt: 1,
  availableQuestionCount: 0,
});
it('preserves page order and removes duplicate ids within and across pages', () => {
  expect(
    appendCatalog([item(3), item(2)], [item(2), item(1), item(1)]).map(
      (v) => v.id,
    ),
  ).toEqual([3, 2, 1]);
});
it('accepts only safe positive integer ids', () => {
  for (const id of ['abc', '0', '-1', '01', '9007199254740992', '1/2'])
    expect(validCatalogId(id)).toBe(false);
  expect(validCatalogId('12')).toBe(true);
});
it('never exposes error content and distinguishes permission and unavailable details', () => {
  expect(catalogError({ statusCode: 403, message: 'SECRET' })).toContain(
    '権限',
  );
  expect(catalogError({ statusCode: 404 }, true)).toBe(
    catalogError({ statusCode: 400 }, true),
  );
  expect(catalogError(new Error('SECRET'))).not.toContain('SECRET');
});
