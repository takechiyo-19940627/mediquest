export interface ReportReceipt {
  id: number;
  message: string;
  status: 'open' | 'confirmed' | 'dismissed';
  createdAt: number;
  replayed?: boolean;
}
export interface AdminReport extends ReportReceipt {
  versionId: number;
  resolvedAt: number | null;
  resolutionNote: string | null;
  version: {
    id: number;
    body: string;
    choices: { id: string; label: string }[];
    answerIds: string[];
    explanation: string;
    quote: string;
    sourceId: number;
    invalidatedAt: number | null;
    invalidationReason: string | null;
  };
}
export const reportStatus = {
  open: '未対応',
  confirmed: '不備確定',
  dismissed: '問題なし',
};
export function reportError(cause: unknown) {
  const code =
    (cause as { statusCode?: number; status?: number })?.statusCode ??
    (cause as { status?: number })?.status;
  if (code === 403) return 'この環境では報告を利用できません。';
  if (code === 400 || code === 404)
    return '対象の報告または問題を表示できません。';
  return '通信結果を確認できません。保存状態を確認してから再試行してください。';
}
