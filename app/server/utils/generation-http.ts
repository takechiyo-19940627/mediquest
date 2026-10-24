import { getHeader, setHeader, setResponseStatus } from 'h3';
import type { H3Event } from 'h3';
import { requireLocalRequest } from '../services/local-admin';
import { withSourceDatabase } from './source-http';
import { SourceError, safeSourceError } from '../services/source-errors';
import { GenerationError } from '../services/generation/contract';
const messages = {
  invalid: [400, '生成要求を確認してください。'],
  forbidden: [403, 'この操作は許可されていません。'],
  missing: [404, '教材または生成受付が見つかりません。'],
  conflict: [409, '同じ生成キーで異なる内容は受け付けられません。'],
  storage: [500, '生成状態の保存に失敗しました。'],
  unavailable: [503, '問題生成が設定されていません。'],
} as const;
export async function generationEndpoint(
  event: H3Event,
  action: () => unknown | Promise<unknown>,
) {
  setHeader(event, 'Cache-Control', 'no-store');
  try {
    requireLocalRequest(process.env, {
      remoteAddress: event.node.req.socket.remoteAddress,
      host: getHeader(event, 'host'),
      origin: getHeader(event, 'origin'),
    });
    withSourceDatabase(() => undefined);
    return await action();
  } catch (error) {
    if (error instanceof SourceError) {
      const safe = safeSourceError(error);
      setResponseStatus(event, safe.status);
      return safe.body;
    }
    const code = error instanceof GenerationError ? error.code : 'storage';
    const [status, message] = messages[code];
    setResponseStatus(event, status);
    return { error: { code, message } };
  }
}
export function responseCancellation(event: H3Event) {
  const controller = new AbortController();
  const close = () => {
    if (!event.node.res.writableFinished) controller.abort();
  };
  event.node.res.on('close', close);
  if (event.node.res.destroyed) controller.abort();
  return {
    signal: controller.signal,
    dispose: () => event.node.res.off('close', close),
  };
}
