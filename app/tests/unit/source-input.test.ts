import { describe, expect, it } from 'vitest';
import {
  sourceInput,
  sourceId,
  sourcePage,
  sourceHash,
  requestKey,
} from '../../server/services/source-input';
import {
  localOrigin,
  requireLocalRequest,
} from '../../server/services/local-admin';
import {
  safeSourceError,
  SourceError,
} from '../../server/services/source-errors';

describe('source input contract', () => {
  it.each([
    null,
    [],
    1,
    'value',
    {},
    { title: 1, body: 'b' },
    { title: 't', body: null },
    { title: ' ', body: 'b' },
    { title: 't', body: '\n ' },
    { title: 't', body: 'b', createdBy: 1 },
  ])('rejects invalid input %#', (value) => {
    expect(() => sourceInput(value)).toThrow(SourceError);
  });
  it('counts Unicode code points and preserves body whitespace and markup as data', () => {
    const input = sourceInput({
      title: ` ${'😀'.repeat(200)} `,
      body: '\n <script>secret</script> \n',
    });
    expect([...input.title]).toHaveLength(200);
    expect(input.body).toBe('\n <script>secret</script> \n');
    expect(() => sourceInput({ title: '😀'.repeat(201), body: 'b' })).toThrow();
    expect(
      sourceInput({ title: 't', body: '😀'.repeat(100000) }).body,
    ).toHaveLength(200000);
    expect(() =>
      sourceInput({ title: 't', body: '😀'.repeat(100001) }),
    ).toThrow();
  });
  it.each(['0', '-1', '1.2', '1e2', '01', '9007199254740992', undefined])(
    'rejects invalid id %s',
    (id) => expect(() => sourceId(id)).toThrow(),
  );
  it('normalizes title before hashing and distinguishes body changes', () => {
    expect(sourceHash(sourceInput({ title: ' t ', body: 'b' }))).toBe(
      sourceHash({ title: 't', body: 'b' }),
    );
    expect(sourceHash({ title: 't', body: 'b ' })).not.toBe(
      sourceHash({ title: 't', body: 'b' }),
    );
    expect(sourceId('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('validates paging and UUID request keys', () => {
    expect(sourcePage({})).toEqual({ limit: 20, before: undefined });
    expect(sourcePage({ limit: '100', before: '0:1' })).toEqual({
      limit: 100,
      before: { createdAt: 0, id: 1 },
    });
    for (const query of [
      { limit: '101' },
      { before: '1.5:2' },
      { limit: ['1'] },
      { role: 'admin' },
    ])
      expect(() => sourcePage(query)).toThrow();
    expect(requestKey('AAAAAAAA-0000-0000-0000-000000000000')).toBe(
      'aaaaaaaa-0000-0000-0000-000000000000',
    );
    expect(() => requestKey('invalid')).toThrow();
  });
  it('requires explicit local mode and a canonical loopback origin', () => {
    expect(() => localOrigin({})).toThrow();
    for (const origin of [
      'https://example.com',
      'http://127.0.0.1/admin',
      'http://u:p@localhost',
      'http://localhost?x=y',
    ])
      expect(() =>
        localOrigin({
          MEDIQUEST_LOCAL_MODE: 'true',
          MEDIQUEST_LOCAL_ORIGIN: origin,
        }),
      ).toThrow();
    expect(
      localOrigin({
        MEDIQUEST_LOCAL_MODE: 'true',
        MEDIQUEST_LOCAL_ORIGIN: 'http://127.0.0.1:3000',
      }).origin,
    ).toBe('http://127.0.0.1:3000');
  });
  it('never serializes raw exceptions or SQL details', () => {
    const safe = safeSourceError(
      new Error('secret /private/db.sqlite SELECT body'),
    );
    expect(safe).toEqual({
      status: 500,
      body: {
        error: {
          code: 'internal',
          message: '処理に失敗しました。時間をおいて再試行してください。',
        },
      },
    });
  });
});

it('rejects remote sockets even with a forged local Host and absent Origin', () => {
  const env = {
    MEDIQUEST_LOCAL_MODE: 'true',
    MEDIQUEST_LOCAL_ORIGIN: 'http://localhost:3000',
  };
  for (const remoteAddress of ['192.168.1.2', '8.8.8.8', undefined]) {
    expect(() =>
      requireLocalRequest(env, { remoteAddress, host: 'localhost:3000' }),
    ).toThrow();
  }
  for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    expect(() =>
      requireLocalRequest(env, { remoteAddress, host: 'localhost:3000' }),
    ).not.toThrow();
  }
});
