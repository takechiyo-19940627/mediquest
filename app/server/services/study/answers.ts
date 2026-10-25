import { SourceError } from '../source-errors';
import { StudyError } from './input';
function ids(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 6 ||
    value.some(
      (id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(id),
    ) ||
    new Set(value).size !== value.length
  )
    throw new SourceError('invalid');
  return [...value].sort() as string[];
}
export function answerInput(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== 'selectedIds')
  )
    throw new SourceError('invalid');
  return { selectedIds: ids((value as Record<string, unknown>).selectedIds) };
}
export function gradeAnswer(
  selectedIds: string[],
  choices: unknown,
  answerIds: unknown,
) {
  selectedIds = ids(selectedIds);
  let correct: string[];
  let available: string[];
  try {
    if (!Array.isArray(choices) || choices.length < 2 || choices.length > 6)
      throw new Error();
    available = ids(choices.map((choice) => choice.id));
    correct = ids(answerIds);
    if (correct.some((id) => !available.includes(id))) throw new Error();
  } catch {
    throw new StudyError('conflict');
  }
  if (
    selectedIds.length !== correct.length ||
    selectedIds.some((id) => !available.includes(id))
  )
    throw new SourceError('invalid');
  return selectedIds.every((id, index) => id === correct[index]);
}
export function itemState(
  item: { excludedAt: number | null; answeredAt: number | null },
  questionStatus: string,
  invalidatedAt: number | null = null,
) {
  return invalidatedAt !== null || item.excludedAt !== null
    ? ('excluded' as const)
    : item.answeredAt !== null
      ? ('answered' as const)
      : questionStatus === 'stopped'
        ? ('excluded' as const)
        : ('unanswered' as const);
}
// Issue #41: shared next-item rule for start/GET/answer/resume/history.
// Items arrive in stored position order. Ordinary unanswered items come first,
// then skipped unanswered items in the same stored order. Skipping again never
// rotates the order, so an all-skipped session returns to its first skip.
export function nextItemId(
  items: {
    id: number;
    state: 'excluded' | 'answered' | 'unanswered';
    skippedAt: number | null;
  }[],
) {
  const unanswered = items.filter((item) => item.state === 'unanswered');
  return (
    unanswered.find((item) => item.skippedAt === null)?.id ??
    unanswered[0]?.id ??
    null
  );
}
export function statistics(
  items: {
    state: 'excluded' | 'answered' | 'unanswered';
    isCorrect: boolean | null;
    skippedAt?: number | null;
  }[],
) {
  const totalItemCount = items.length;
  const excludedCount = items.filter((i) => i.state === 'excluded').length;
  const eligibleCount = totalItemCount - excludedCount;
  const answeredEligibleCount = items.filter(
    (i) => i.state === 'answered',
  ).length;
  const correctEligibleCount = items.filter(
    (i) => i.state === 'answered' && i.isCorrect === true,
  ).length;
  return {
    totalItemCount,
    excludedCount,
    eligibleCount,
    answeredEligibleCount,
    // Skipped items stay inside unansweredEligibleCount; this only counts them.
    unansweredEligibleCount: eligibleCount - answeredEligibleCount,
    skippedUnansweredCount: items.filter(
      (i) => i.state === 'unanswered' && (i.skippedAt ?? null) !== null,
    ).length,
    correctEligibleCount,
    accuracy: eligibleCount ? correctEligibleCount / eligibleCount : null,
    accuracyStatus: eligibleCount
      ? ('available' as const)
      : ('no_eligible_items' as const),
  };
}

export function exclusionReason(
  item: {
    excludedReason: 'stopped' | 'invalidated' | null;
    answeredAt: number | null;
  },
  questionStatus: string,
  invalidatedAt: number | null,
) {
  return invalidatedAt !== null
    ? ('invalidated' as const)
    : (item.excludedReason ??
        (item.answeredAt === null && questionStatus === 'stopped'
          ? ('stopped' as const)
          : null));
}
