import { expect, it } from 'vitest';
import { resolutionInput } from '../../server/services/reports/input';
import { itemState } from '../../server/services/study/answers';
it('validates decisions and Unicode note boundaries without accepting identity fields', () => {
  expect(resolutionInput({ decision: 'confirmed', note: ' 理由 ' })).toEqual({
    decision: 'confirmed',
    note: '理由',
  });
  expect(
    resolutionInput({ decision: 'dismissed', note: '😀'.repeat(2000) }).note,
  ).toHaveLength(4000);
  for (const value of [
    null,
    {},
    [],
    { decision: 'open', note: 'x' },
    { decision: 'confirmed', note: ' ' },
    { decision: 'confirmed', note: 1 },
    { decision: 'confirmed', note: 'x', resolvedBy: 1 },
    { decision: 'confirmed', note: '😀'.repeat(2001) },
  ])
    expect(() => resolutionInput(value)).toThrow('invalid');
});
it('prioritizes invalidated versions over answered/stopped status', () => {
  expect(itemState({ answeredAt: 1, excludedAt: null }, 'active', 2)).toBe(
    'excluded',
  );
  expect(itemState({ answeredAt: 1, excludedAt: null }, 'stopped', 2)).toBe(
    'excluded',
  );
  expect(itemState({ answeredAt: 1, excludedAt: null }, 'stopped', null)).toBe(
    'answered',
  );
});
