import { expect, it } from 'vitest';
import {
  itemsInput,
  publishInput,
} from '../../server/services/publication/input';
it('accepts bounded ordered selections and rejects malformed revisions, duplicates and identity fields', () => {
  expect(itemsInput({ expectedRevision: 0, versionIds: [] })).toEqual({
    expectedRevision: 0,
    versionIds: [],
  });
  expect(
    itemsInput({ expectedRevision: 2, versionIds: [3, 1] }).versionIds,
  ).toEqual([3, 1]);
  for (const value of [
    null,
    { expectedRevision: -1, versionIds: [] },
    { expectedRevision: 0, versionIds: [1, 1] },
    { expectedRevision: 0, versionIds: [0] },
    {
      expectedRevision: 0,
      versionIds: Array.from({ length: 11 }, (_, i) => i + 1),
    },
    { expectedRevision: 0, versionIds: [], publishedBy: 1 },
  ])
    expect(() => itemsInput(value)).toThrow('invalid');
});
it('requires explicit confirmation and exact publication request fingerprint', () => {
  const input = {
    expectedRevision: 0,
    publishFingerprint: 'a'.repeat(64),
    confirmed: true,
  };
  expect(publishInput(input)).toEqual(input);
  for (const value of [
    { ...input, confirmed: false },
    { ...input, publishFingerprint: 'bad' },
    { ...input, publishedAt: 123 },
    { ...input, expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
  ])
    expect(() => publishInput(value)).toThrow('invalid');
});
