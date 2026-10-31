import { describe, expect, it } from 'vitest';
import {
  adminError,
  parseReceipt,
  parseReceiptHistory,
  validAdminId,
} from '../../app/utils/admin-state';
const receipt = {
  sourceId: 4,
  key: 'a1111111-1111-4111-8111-111111111111',
  title: 'セット',
  requestedCount: 2,
  runId: 9,
};
describe('admin client state', () => {
  it('restores only a bounded receipt for the current source', () => {
    expect(parseReceipt(JSON.stringify(receipt), 4)).toEqual(receipt);
    for (const value of [
      null,
      {},
      [],
      { ...receipt, sourceId: 5 },
      { ...receipt, key: 'bad' },
      { ...receipt, title: 'x'.repeat(201) },
      { ...receipt, requestedCount: 0 },
      { ...receipt, requestedCount: 11 },
      { ...receipt, runId: -1 },
      { ...receipt, body: 'never persist source text' },
    ]) {
      expect(parseReceipt(JSON.stringify(value), 4)).toBeNull();
    }
    expect(parseReceipt('{invalid', 4)).toBeNull();
  });
  it('validates history without losing the distinct request identities', () => {
    const another = { ...receipt, key: 'b1111111-1111-4111-8111-111111111111' };
    expect(parseReceiptHistory(JSON.stringify([receipt, another]), 4)).toEqual([
      receipt,
      another,
    ]);
    expect(
      parseReceiptHistory(JSON.stringify([receipt, receipt]), 4),
    ).toBeNull();
    expect(
      parseReceiptHistory(
        JSON.stringify([receipt, { ...another, sourceId: 5 }]),
        4,
      ),
    ).toBeNull();
    expect(parseReceiptHistory('{bad', 4)).toBeNull();
  });
  it('never renders remote exception messages or stacks', () => {
    expect(
      adminError({ statusCode: 500, message: 'SECRET', stack: 'SECRET' }),
    ).not.toContain('SECRET');
    expect(adminError({ statusCode: 403 })).toContain('管理者');
    expect(validAdminId('1')).toBe(true);
    for (const id of ['0', '-1', '1/2', '01', '9007199254740992'])
      expect(validAdminId(id)).toBe(false);
  });
});
