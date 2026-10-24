import { expect, it } from 'vitest';
import { reportInput } from '../../server/services/reports/input';
it('trims and counts Unicode code points through the 2000 character boundary', () => {
  expect(reportInput({ message: '  確認してください  ' })).toEqual({
    message: '確認してください',
  });
  expect(reportInput({ message: '😀'.repeat(2000) }).message).toBe(
    '😀'.repeat(2000),
  );
  for (const value of [
    null,
    [],
    {},
    { message: 1 },
    { message: ' ' },
    { message: '😀'.repeat(2001) },
    { message: 'a', versionId: 1 },
    { message: 'a', reportedBy: 1 },
  ])
    expect(() => reportInput(value)).toThrow('invalid');
});
