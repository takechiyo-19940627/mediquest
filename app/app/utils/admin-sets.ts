import { adminError, adminStatus } from './admin-state';
export interface CandidateContent {
  body: string;
  choices: { id: string; label: string }[];
  answerIds: string[];
  explanation: string;
  quote: string;
}
export interface AdminCandidate extends CandidateContent {
  id: number;
  questionId: number;
  versionNo: number;
  quoteVerified: boolean;
  reviewedBy: number | null;
  reviewedAt: number | null;
  fingerprint: string;
  derivedFromVersionId: number | null;
  manualCreatedBy?: number | null;
}
export interface AdminSetSummary {
  id: number;
  title: string;
  status: 'draft' | 'published' | 'archived';
  sourceId: number;
  candidateCount: number;
  reviewedCount: number;
}
export interface AdminSetDetail {
  id: number;
  title: string;
  description: string;
  status: AdminSetSummary['status'];
  sourceId: number;
  revision: number;
  publishedAt: number | null;
  supersedesSetId: number | null;
  publishFingerprint: string;
  candidates: AdminCandidate[];
  items: {
    versionId: number;
    position: number;
    questionId: number;
    invalidatedAt: number | null;
    reviewedBy: number | null;
    reviewedAt: number | null;
    questionStatus: string;
    generationStatus: string | null;
  }[];
}
export const setStatusLabel = {
  draft: '下書き',
  published: '公開中',
  archived: '公開停止',
};
export function setError(cause: unknown): string {
  if (adminStatus(cause) === 409)
    return '内容または状態が変わったため操作を確定できません。最新状態を確認してください。';
  if (adminStatus(cause) === 404) return 'セットまたは候補が見つかりません。';
  return adminError(cause);
}
export function contentValid(value: CandidateContent): boolean {
  const text = (value: string, max: number) =>
    Boolean(value.trim()) && [...value].length <= max;
  const ids = new Set(value.choices.map((choice) => choice.id));
  return (
    [value.body, value.explanation, value.quote].every((value) =>
      text(value, 10000),
    ) &&
    value.choices.length >= 2 &&
    value.choices.length <= 6 &&
    ids.size === value.choices.length &&
    value.choices.every(
      (choice) =>
        /^[A-Za-z0-9_-]{1,40}$/.test(choice.id) && text(choice.label, 2000),
    ) &&
    value.answerIds.length > 0 &&
    new Set(value.answerIds).size === value.answerIds.length &&
    value.answerIds.every((id) => ids.has(id))
  );
}
export function selectionPublishable(
  set: AdminSetDetail,
  selected: number[],
): boolean {
  return (
    set.status === 'draft' &&
    selected.length > 0 &&
    selected.length <= 10 &&
    selected.length === set.items.length &&
    set.items.every(
      (item, index) =>
        item.versionId === selected[index] &&
        item.position === index &&
        item.reviewedBy !== null &&
        item.reviewedAt !== null &&
        item.invalidatedAt === null &&
        item.questionStatus === 'active' &&
        (item.generationStatus === 'succeeded' ||
          item.generationStatus === null),
    )
  );
}
