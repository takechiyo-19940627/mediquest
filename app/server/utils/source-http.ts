import { getHeader, setHeader, setResponseStatus } from 'h3';
import type { H3Event } from 'h3';
import { openDatabase } from '../db/connection';
import type { Connection } from '../db/connection';
import {
  requireLocalRequest,
  requireAdministrator,
} from '../services/local-admin';
import { SourceError, safeSourceError } from '../services/source-errors';
import { maxRequestBytes } from '../services/source-input';

export function withSourceDatabase<T>(
  action: (connection: Connection) => T,
): T {
  const connection = openDatabase();
  try {
    requireAdministrator(connection);
    return action(connection);
  } finally {
    connection.close();
  }
}
export async function sourceEndpoint(
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
    // Authorize before reading the body, but never hold a SQLite connection while waiting for it.
    withSourceDatabase(() => undefined);
    return await action();
  } catch (error) {
    const safe = safeSourceError(error);
    setResponseStatus(event, safe.status);
    return safe.body;
  }
}
export async function limitedSourceJson(event: H3Event): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;.*)?$/i.test(
      getHeader(event, 'content-type') ?? '',
    )
  )
    throw new SourceError('media_type');
  const req = event.node.req;
  const length = getHeader(event, 'content-length');
  if (length && Number(length) > maxRequestBytes) {
    req.resume();
    throw new SourceError('too_large');
  }
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    const timer = setTimeout(() => {
      failed = true;
      chunks.length = 0;
      reject(new SourceError('invalid'));
      req.resume();
    }, 10000);
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > maxRequestBytes) {
        failed = true;
        clearTimeout(timer);
        chunks.length = 0;
        reject(new SourceError('too_large'));
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      clearTimeout(timer);
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on('error', () => {
      clearTimeout(timer);
      failed = true;
      reject(new SourceError('invalid'));
    });
    req.on('aborted', () => {
      clearTimeout(timer);
      failed = true;
      reject(new SourceError('invalid'));
    });
  });
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new SourceError('invalid');
  }
}
