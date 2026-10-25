import { expect, it } from 'vitest';
import {
  answerInput,
  gradeAnswer,
  itemState,
  nextItemId,
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
    // Issue #41 adds skippedUnansweredCount; the other keys are unchanged.
    skippedUnansweredCount: 0,
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
// Issue #41 AC-2/AC-3: ordinary unanswered first in stored order, then skipped
// unanswered in stored order; answered/excluded never become current.
it('selects ordinary unanswered before skipped unanswered in stored order and counts only eligible skips', () => {
  const unanswered = (id: number, skippedAt: number | null = null) => ({
    id,
    state: 'unanswered' as const,
    isCorrect: null,
    skippedAt,
  });
  const answered = (id: number, skippedAt: number | null = null) => ({
    id,
    state: 'answered' as const,
    isCorrect: true,
    skippedAt,
  });
  const excluded = (id: number, skippedAt: number | null = null) => ({
    id,
    state: 'excluded' as const,
    isCorrect: null,
    skippedAt,
  });
  expect(nextItemId([])).toBeNull();
  expect(nextItemId([unanswered(1), unanswered(2)])).toBe(1);
  // A skipped first item yields to the later ordinary unanswered item.
  expect(nextItemId([unanswered(1, 10), unanswered(2), unanswered(3)])).toBe(2);
  // Skipped items return in stored order, not by skip time, so the newest skip
  // never rotates ahead of the first.
  expect(
    nextItemId([unanswered(1, 30), unanswered(2, 10), unanswered(3, 20)]),
  ).toBe(1);
  expect(nextItemId([answered(1, 5), unanswered(2, 10), answered(3)])).toBe(2);
  expect(nextItemId([excluded(1, 5), answered(2), unanswered(3, 10)])).toBe(3);
  expect(nextItemId([excluded(1, 5), answered(2, 6), excluded(3)])).toBeNull();
  // One skipped unanswered item stays current while unanswered.
  expect(nextItemId([answered(1), unanswered(2, 7)])).toBe(2);
  expect(
    statistics([
      unanswered(1, 10),
      unanswered(2),
      excluded(3, 10),
      answered(4, 10),
      unanswered(5, 20),
    ]),
  ).toEqual({
    totalItemCount: 5,
    excludedCount: 1,
    eligibleCount: 4,
    answeredEligibleCount: 1,
    unansweredEligibleCount: 3,
    skippedUnansweredCount: 2,
    correctEligibleCount: 1,
    accuracy: 0.25,
    accuracyStatus: 'available',
  });
  expect(statistics([excluded(1, 10), excluded(2, 20)])).toMatchObject({
    unansweredEligibleCount: 0,
    skippedUnansweredCount: 0,
    accuracy: null,
    accuracyStatus: 'no_eligible_items',
  });
});
