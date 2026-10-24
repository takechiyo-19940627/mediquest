import { getHeader, setHeader, setResponseStatus } from 'h3';
import type { H3Event } from 'h3';
import { openDatabase } from '../db/connection';
import type { Connection } from '../db/connection';
import { requireLocalRequest } from '../services/local-admin';
import { requireLocalLearner } from '../services/learning-catalog/service';
import { safeSourceError } from '../services/source-errors';
import { StudyError } from '../services/study/input';
export function withStudyDatabase<T>(action: (connection: Connection) => T) {
  const connection = openDatabase();
  try {
    requireLocalLearner(connection);
    return action(connection);
  } finally {
    connection.close();
  }
}
export async function studyEndpoint(
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
    withStudyDatabase(() => undefined);
    return await action();
  } catch (error) {
    if (error instanceof StudyError) {
      setResponseStatus(event, error.code === 'missing' ? 404 : 409);
      return {
        error: {
          code: error.code,
          message:
            error.code === 'missing'
              ? '演習または問題が見つかりません。'
              : '演習を開始できません。現在の状態を確認してください。',
        },
      };
    }
    const safe = safeSourceError(error);
    setResponseStatus(event, safe.status);
    return safe.body;
  }
}
