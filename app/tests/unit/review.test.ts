import { expect, it } from 'vitest';
import {
  contentInput,
  fingerprint,
  reviewInput,
} from '../../server/services/review/input';
import { candidate } from '../fixtures/generation';
const version = {
  id: 1,
  body: '問題',
  choicesJson: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
  answerIdsJson: ['a'],
  explanation: '説明',
  quote: '引用',
};
it('fingerprints every displayed content field and ordered choices deterministically', () => {
  expect(fingerprint({ ...version })).toBe(fingerprint(version));
  for (const patch of [
    { id: 2 },
    { body: '別問題' },
    { choicesJson: [...version.choicesJson].reverse() },
    { choicesJson: [{ id: 'a', label: '別' }, version.choicesJson[1]!] },
    { answerIdsJson: ['b'] },
    { explanation: '別' },
    { quote: '別' },
  ])
    expect(fingerprint({ ...version, ...patch })).not.toBe(
      fingerprint(version),
    );
});
it('requires explicit confirmation and exact bounded input without client identity', () => {
  const valid = { fingerprint: fingerprint(version), confirmed: true };
  expect(reviewInput(valid).acknowledgeQuoteMismatch).toBe(false);
  for (const value of [
    null,
    [],
    {},
    { ...valid, confirmed: false },
    { ...valid, fingerprint: 'a'.repeat(65) },
    { ...valid, reviewedBy: 1 },
    { ...valid, quoteVerified: true },
    { ...valid, acknowledgeQuoteMismatch: 'true' },
  ])
    expect(() => reviewInput(value)).toThrow('invalid');
});
// Issue #48: the content edit body is the complete content plus the expected
// set revision and content fingerprint, validated with the generation contract.
it('normalizes a complete content edit and rejects identity, state, unknown and out-of-contract fields', () => {
  const content = candidate('修正した問題');
  const valid = {
    expectedRevision: 0,
    expectedFingerprint: fingerprint(version),
    ...content,
  };
  expect(contentInput(valid)).toEqual({
    expectedRevision: 0,
    expectedFingerprint: fingerprint(version),
    content,
  });
  expect(
    contentInput({ ...valid, expectedRevision: Number.MAX_SAFE_INTEGER })
      .expectedRevision,
  ).toBe(Number.MAX_SAFE_INTEGER);
  const long = contentInput({
    ...valid,
    body: '問'.repeat(10000),
    explanation: '説'.repeat(10000),
    quote: '引'.repeat(10000),
    choices: Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`.padEnd(40, '_'),
      label: 'ラ'.repeat(2000),
    })),
    answerIds: ['c0'.padEnd(40, '_'), 'c5'.padEnd(40, '_')],
  });
  expect(long.content.choices).toHaveLength(6);
  expect(long.content.answerIds).toHaveLength(2);
  expect(
    contentInput({ ...valid, quote: '教材にない引用' }).content.quote,
  ).toBe('教材にない引用');
  const omit = (key: string) =>
    Object.fromEntries(Object.entries(valid).filter(([k]) => k !== key));
  for (const value of [
    null,
    [],
    {},
    '問題',
    omit('body'),
    omit('quote'),
    omit('choices'),
    omit('expectedRevision'),
    omit('expectedFingerprint'),
    { ...valid, id: 1 },
    { ...valid, questionId: 1 },
    { ...valid, versionNo: 2 },
    { ...valid, sourceId: 1 },
    { ...valid, generationRunId: 1 },
    { ...valid, reviewedBy: 1 },
    { ...valid, reviewedAt: 1 },
    { ...valid, quoteVerified: true },
    { ...valid, confirmed: true },
    { ...valid, expectedRevision: -1 },
    { ...valid, expectedRevision: 1.5 },
    { ...valid, expectedRevision: '0' },
    { ...valid, expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, expectedFingerprint: 'a'.repeat(63) },
    { ...valid, expectedFingerprint: 'A'.repeat(64) },
    { ...valid, expectedFingerprint: 'a'.repeat(65) },
    { ...valid, body: '' },
    { ...valid, body: '   ' },
    { ...valid, body: 1 },
    { ...valid, body: '問'.repeat(10001) },
    { ...valid, explanation: '' },
    { ...valid, explanation: '説'.repeat(10001) },
    { ...valid, quote: '' },
    { ...valid, quote: '引'.repeat(10001) },
    { ...valid, choices: [content.choices[0]] },
    {
      ...valid,
      choices: Array.from({ length: 7 }, (_, i) => ({
        id: `c${i}`,
        label: `L${i}`,
      })),
      answerIds: ['c0'],
    },
    { ...valid, choices: [...content.choices, { id: 'a', label: '重複' }] },
    { ...valid, choices: [{ id: 'a b', label: 'A' }, content.choices[1]] },
    {
      ...valid,
      choices: [{ id: 'a'.repeat(41), label: 'A' }, content.choices[1]],
    },
    {
      ...valid,
      choices: [{ id: 'a', label: 'ラ'.repeat(2001) }, content.choices[1]],
    },
    {
      ...valid,
      choices: [{ id: 'a', label: 'A', correct: true }, content.choices[1]],
    },
    { ...valid, choices: 'ab' },
    { ...valid, answerIds: [] },
    { ...valid, answerIds: ['z'] },
    { ...valid, answerIds: ['a', 'a'] },
    { ...valid, answerIds: 'a' },
    { ...valid, answerIds: [1] },
  ])
    expect(() => contentInput(value)).toThrow('invalid');
});
