import { expect, it } from 'vitest';
import { manualInput } from '../../server/services/manual/service';
import { candidate } from '../fixtures/generation';
it('validates manual questions with the same limits and multi-answer invariants as generated candidates', () => {
  expect(
    manualInput({
      title: ' 手動 ',
      questions: [{ ...candidate(), answerIds: ['a', 'b'] }],
    }),
  ).toMatchObject({ title: '手動', questions: [{ answerIds: ['a', 'b'] }] });
  for (const questions of [
    [],
    Array.from({ length: 11 }, () => candidate()),
    [{ ...candidate(), answerIds: ['missing'] }],
    [{ ...candidate(), answerIds: ['a', 'a'] }],
    [{ ...candidate(), choices: [{ id: 'a', label: 'a' }] }],
    [{ ...candidate(), explanation: '' }],
    [{ ...candidate(), quote: '' }],
    [{ ...candidate(), body: 'x'.repeat(10001) }],
    [{ ...candidate(), quoteVerified: true }],
  ]) {
    expect(() => manualInput({ title: '手動', questions })).toThrow('invalid');
  }
  expect(() =>
    manualInput({
      title: '手動',
      questions: [candidate()],
      generationRunId: 1,
    }),
  ).toThrow('invalid');
});
