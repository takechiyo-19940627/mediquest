import { expect, it } from 'vitest';
import { stopInput } from '../../server/services/questions/input';
// Issue #50: stopping a question takes only an empty object; the question,
// administrator, status and time are never chosen by the client.
it('accepts only an empty stop request', () => {
  expect(stopInput({})).toEqual({});
  for (const value of [
    null,
    undefined,
    [],
    'stop',
    0,
    { status: 'stopped' },
    { status: 'active' },
    { userId: 1 },
    { stoppedBy: 1 },
    { questionId: 1 },
    { versionId: 1 },
    { reason: 'x' },
    { expectedRevision: 1 },
    { confirmed: true },
  ])
    expect(() => stopInput(value)).toThrow('invalid');
});
