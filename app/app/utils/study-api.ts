export interface StudySummary {
  id: number;
  setId: number;
  status: 'in_progress' | 'completed';
  currentItemId: number | null;
  items: {
    id: number;
    position: number;
    state: 'unanswered' | 'answered' | 'excluded';
    skippedAt: number | null;
  }[];
  statistics: {
    totalItemCount: number;
    answeredEligibleCount: number;
    eligibleCount: number;
    excludedCount: number;
    correctEligibleCount: number;
    skippedUnansweredCount: number;
    unansweredEligibleCount: number;
  };
}
export interface StudyItem {
  questionNumber?: string;
  id: number;
  position: number;
  state?: 'excluded';
  excludedReason?: 'invalidated';
  body?: string;
  choices?: { id: string; label: string }[];
  requiredSelectionCount?: number;
  feedback?: {
    selectedIds: string[];
    isCorrect: boolean;
    answerIds: string[];
    explanation: string;
    quote: string;
  };
}
export function studyStatus(error: unknown) {
  return (
    (error as { statusCode?: number; status?: number })?.statusCode ??
    (error as { status?: number })?.status
  );
}
export function studyError(error: unknown) {
  const status = studyStatus(error);
  if (status === 403) return 'この環境では演習を利用できません。';
  if (status === 404 || status === 400)
    return 'この演習または問題を表示できません。';
  if (status === 409)
    return '現在の状態では操作できません。保存状態を確認してください。';
  return '通信結果を確認できません。保存状態を確認してから再試行してください。';
}

export interface StudyHistoryEntry {
  id: number;
  setTitle: string;
  status: 'in_progress' | 'completed';
  mode: 'normal' | 'review';
  startedAt: number;
  statistics: StudySummary['statistics'];
}
export interface StudyHistoryPage {
  items: StudyHistoryEntry[];
  nextCursor: string | null;
}
