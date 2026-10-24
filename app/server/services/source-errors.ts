export const sourceErrors = {
  invalid: [400, '入力内容を確認してください。'],
  forbidden: [403, 'この操作は許可されていません。'],
  missing: [404, '教材が見つかりません。'],
  conflict: [409, '同じ登録キーで異なる内容は保存できません。'],
  too_large: [413, '教材のサイズが上限を超えています。'],
  media_type: [415, 'JSON形式で送信してください。'],
  internal: [500, '処理に失敗しました。時間をおいて再試行してください。'],
} as const;
export class SourceError extends Error {
  constructor(public code: keyof typeof sourceErrors) {
    super(code);
  }
}
export function safeSourceError(error: unknown) {
  const code = error instanceof SourceError ? error.code : 'internal';
  const [status, message] = sourceErrors[code];
  return { status, body: { error: { code, message } } };
}
