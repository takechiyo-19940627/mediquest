export interface SourceSummary {
  id: number;
  title: string;
  createdAt: number;
}
export interface SourceDetail extends SourceSummary {
  body: string;
}
export function adminStatus(cause: unknown): number | undefined {
  if (!cause || typeof cause !== 'object') return;
  return 'statusCode' in cause ? Number(cause.statusCode) : undefined;
}
export function adminError(cause: unknown): string {
  switch (adminStatus(cause)) {
    case 403:
      return '管理者としてこの操作を利用できません。';
    case 404:
      return '教材または受付が見つかりません。';
    case 400:
    case 413:
      return '入力内容と文字数を確認してください。';
    case 409:
      return '同じ受付で異なる内容は送信できません。';
    case 503:
      return '問題生成が設定されていません。設定を確認してから同じ受付を確認してください。';
    default:
      return '通信または処理に問題がありました。内容を保持したまま再確認できます。';
  }
}
export function validAdminId(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));
}
export interface GenerationReceipt {
  sourceId: number;
  key: string;
  title: string;
  requestedCount: number;
  runId?: number;
}
export interface GenerationRun {
  id: number;
  sourceId?: number;
  setId: number;
  status: 'running' | 'succeeded' | 'failed' | 'unknown';
  updatedAt?: number;
}
export function parseReceipt(
  raw: string | null,
  sourceId: number,
): GenerationReceipt | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some(
        (key) =>
          !['sourceId', 'key', 'title', 'requestedCount', 'runId'].includes(
            key,
          ),
      ) ||
      value.sourceId !== sourceId ||
      typeof value.key !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value.key,
      ) ||
      typeof value.title !== 'string' ||
      !value.title.trim() ||
      [...value.title].length > 200 ||
      !Number.isInteger(value.requestedCount) ||
      value.requestedCount < 1 ||
      value.requestedCount > 10 ||
      (value.runId !== undefined &&
        (!Number.isSafeInteger(value.runId) || value.runId < 1))
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export function parseReceiptHistory(
  raw: string | null,
  sourceId: number,
): GenerationReceipt[] | null {
  if (!raw) return [];
  try {
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return null;
    const receipts = values.map((value) =>
      parseReceipt(JSON.stringify(value), sourceId),
    );
    if (receipts.some((value) => value === null)) return null;
    const valid = receipts as GenerationReceipt[];
    if (new Set(valid.map((value) => value.key)).size !== valid.length)
      return null;
    return valid;
  } catch {
    return null;
  }
}
