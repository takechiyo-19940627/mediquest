import { expect, it } from 'vitest';
import {
  answerInput,
  gradeAnswer,
  itemState,
  statistics,
} from '../../server/services/study/answers';
const choices = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'c', label: 'C' },
];
it('normalizes sets and grades exact single/multiple answers without partial credit', () => {
  expect(answerInput({ selectedIds: ['c', 'a'] })).toEqual({
    selectedIds: ['a', 'c'],
  });
  expect(gradeAnswer(['a'], choices, ['a'])).toBe(true);
  expect(gradeAnswer(['b'], choices, ['a'])).toBe(false);
  expect(gradeAnswer(['c', 'a'], choices, ['a', 'c'])).toBe(true);
  expect(gradeAnswer(['a', 'b'], choices, ['a', 'c'])).toBe(false);
  for (const selected of [['a'], ['a', 'b', 'c'], ['a', 'x']])
    expect(() => gradeAnswer(selected, choices, ['a', 'c'])).toThrow('invalid');
});
it('rejects malformed bounded inputs and invalid stored choice/answer contracts', () => {
  for (const value of [
    null,
    [],
    {},
    { selectedIds: [] },
    { selectedIds: ['a', 'a'] },
    { selectedIds: ['あ'] },
    { selectedIds: ['x'.repeat(41)] },
    { selectedIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
    { selectedIds: ['a'], isCorrect: true },
    { selectedIds: ['a'], userId: 1 },
  ])
    expect(() => answerInput(value)).toThrow('invalid');
  for (const [options, answers] of [
    [choices, []],
    [choices, ['x']],
    [[{ id: 'a' }, { id: 'a' }], ['a']],
    [null, ['a']],
  ])
    expect(() => gradeAnswer(['a'], options, answers)).toThrow('conflict');
});
it('keeps answered stopped items eligible, explicit exclusion first, and zero denominator null', () => {
  expect(itemState({ answeredAt: 1, excludedAt: null }, 'stopped')).toBe(
    'answered',
  );
  expect(itemState({ answeredAt: 1, excludedAt: 2 }, 'active')).toBe(
    'excluded',
  );
  expect(
    statistics([
      { state: 'answered', isCorrect: true },
      { state: 'unanswered', isCorrect: null },
      { state: 'excluded', isCorrect: true },
    ]),
  ).toEqual({
    totalItemCount: 3,
    excludedCount: 1,
    eligibleCount: 2,
    answeredEligibleCount: 1,
    unansweredEligibleCount: 1,
    correctEligibleCount: 1,
    accuracy: 0.5,
    accuracyStatus: 'available',
  });
  expect(statistics([{ state: 'excluded', isCorrect: true }])).toMatchObject({
    accuracy: null,
    accuracyStatus: 'no_eligible_items',
    correctEligibleCount: 0,
  });
});
