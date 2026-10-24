import { expect, it } from 'vitest';
import { fingerprint, reviewInput } from '../../server/services/review/input';
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
