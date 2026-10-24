import { setResponseStatus } from 'h3';
import type { H3Event } from 'h3';
import { sourceEndpoint } from './source-http';
import { ReviewError } from '../services/review/input';
export function reviewEndpoint(
  event: H3Event,
  action: () => unknown | Promise<unknown>,
) {
  return sourceEndpoint(event, async () => {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof ReviewError)) throw error;
      setResponseStatus(event, error.code === 'missing' ? 404 : 409);
      return {
        error: {
          code: error.code,
          message:
            error.code === 'missing'
              ? '対象のセットまたは候補が見つかりません。'
              : '候補の内容または状態を再確認してください。',
        },
      };
    }
  });
}
