import { expect, it } from 'vitest';
import { startInput, resumeInput } from '../../server/services/study/input';
it('accepts only positive set ids and an empty explicit resume payload', () => {
  expect(startInput({ setId: 1 })).toEqual({ setId: 1 });
  expect(() => resumeInput({})).not.toThrow();
  for (const value of [
    null,
    [],
    {},
    { setId: 0 },
    { setId: '1' },
    { setId: 1, userId: 2 },
    { setId: 1, mode: 'normal' },
    { setId: 1, answerIds: ['a'] },
  ])
    expect(() => startInput(value)).toThrow('invalid');
  for (const value of [null, [], { userId: 1 }, { confirmed: true }])
    expect(() => resumeInput(value)).toThrow('invalid');
});
