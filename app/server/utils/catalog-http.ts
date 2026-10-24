import { getHeader, setHeader, setResponseStatus } from 'h3';
import type { H3Event } from 'h3';
import { openDatabase } from '../db/connection';
import type { Connection } from '../db/connection';
import { requireLocalRequest } from '../services/local-admin';
import {
  requireLocalLearner,
  CatalogMissing,
} from '../services/learning-catalog/service';
import { safeSourceError } from '../services/source-errors';
export function catalogEndpoint(
  event: H3Event,
  action: (connection: Connection) => unknown,
) {
  setHeader(event, 'Cache-Control', 'no-store');
  try {
    requireLocalRequest(process.env, {
      remoteAddress: event.node.req.socket.remoteAddress,
      host: getHeader(event, 'host'),
      origin: getHeader(event, 'origin'),
    });
    const connection = openDatabase();
    try {
      requireLocalLearner(connection);
      return action(connection);
    } finally {
      connection.close();
    }
  } catch (error) {
    if (error instanceof CatalogMissing) {
      setResponseStatus(event, 404);
      return {
        error: { code: 'missing', message: 'セットが見つかりません。' },
      };
    }
    const safe = safeSourceError(error);
    setResponseStatus(event, safe.status);
    return safe.body;
  }
}
