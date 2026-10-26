import { expect, it } from 'vitest';
import {
  revisionInput,
  revisionFingerprint,
} from '../../server/services/revisions/input';
const input = {
  requestKey: 'ABCDEF00-0000-0000-0000-000000000000',
  expectedRevision: 0,
  title: ' title ',
  description: ' text ',
};
it('normalizes UUID/title, preserves description and fingerprints every request field', () => {
  const value = revisionInput(input);
  expect(value).toEqual({
    ...input,
    requestKey: input.requestKey.toLowerCase(),
    title: 'title',
  });
  expect(revisionFingerprint(1, value)).toBe(
    revisionFingerprint(1, revisionInput({ ...input, title: 'title' })),
  );
  for (const changed of [
    { ...value, expectedRevision: 1 },
    { ...value, title: 'x' },
    { ...value, description: 'text' },
  ])
    expect(revisionFingerprint(1, changed)).not.toBe(
      revisionFingerprint(1, value),
    );
  expect(revisionFingerprint(2, value)).not.toBe(revisionFingerprint(1, value));
  expect(
    revisionInput({
      ...input,
      title: '😀'.repeat(200),
      description: '😀'.repeat(2000),
      expectedRevision: Number.MAX_SAFE_INTEGER,
    }),
  ).toBeDefined();
});
it('rejects missing, unknown, mistyped and oversized fields', () => {
  for (const value of [
    null,
    [],
    {},
    { ...input, id: 1 },
    ...['requestKey', 'expectedRevision', 'title', 'description'].map(
      (key) => ({ ...input, [key]: undefined }),
    ),
    ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '0'].map((expectedRevision) => ({
      ...input,
      expectedRevision,
    })),
    { ...input, requestKey: 'bad' },
    { ...input, title: ' ' },
    { ...input, title: '😀'.repeat(201) },
    { ...input, description: '😀'.repeat(2001) },
  ])
    expect(() => revisionInput(value)).toThrow('invalid');
});
