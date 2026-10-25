import { expect, it } from 'vitest';
import {
  startInput,
  resumeInput,
  skipInput,
  reviewStartInput,
} from '../../server/services/study/input';
it('accepts only positive set ids and an empty explicit resume payload', () => {
  expect(startInput({ setId: 1 })).toEqual({ setId: 1 });
  expect(() => resumeInput({})).not.toThrow();
  expect(() => skipInput({})).not.toThrow();
  expect(() => reviewStartInput({})).not.toThrow();
  // Issue #44: the client cannot name the user, parent, versions or grades.
  for (const value of [
    null,
    undefined,
    [],
    'review',
    { userId: 1 },
    { parentSessionId: 1 },
    { versionIds: [1] },
    { questionVersionId: 1 },
    { isCorrect: false },
    { setId: 1 },
    { mode: 'review' },
  ])
    expect(() => reviewStartInput(value)).toThrow('invalid');
  // Issue #41 AC-1: the client cannot name the user, time, or an answer.
  for (const value of [
    null,
    undefined,
    [],
    'skip',
    { userId: 1 },
    { skippedAt: 1 },
    { selectedIds: ['a'] },
    { itemId: 1 },
    { confirmed: true },
  ])
    expect(() => skipInput(value)).toThrow('invalid');
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
