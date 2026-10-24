import { describe, expect, it } from 'vitest';
import {
  generationInput,
  generationHash,
  generationConfig,
  validateGeneration,
} from '../../server/services/generation/validation';
import { GenerationError } from '../../server/services/generation/contract';
import { candidate, output, sourceText } from '../fixtures/generation';
const valid = {
  sourceId: 1,
  requestedCount: 1,
  title: 'セット',
  requestKey: 'aaaaaaaa-0000-0000-0000-000000000000',
};

describe('generation request boundaries', () => {
  it.each([
    null,
    [],
    {},
    { ...valid, sourceId: 0 },
    { ...valid, sourceId: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, requestedCount: 0 },
    { ...valid, requestedCount: 11 },
    { ...valid, requestedCount: 1.5 },
    { ...valid, title: ' ' },
    { ...valid, title: '😀'.repeat(201) },
    { ...valid, requestKey: 'bad' },
    { ...valid, model: 'client-model' },
  ])('rejects malformed request %#', (value) => {
    expect(() => generationInput(value)).toThrow(GenerationError);
  });
  it('normalizes title and keys without including server settings in the request hash', () => {
    expect(
      generationInput({
        ...valid,
        title: ' セット ',
        requestKey: valid.requestKey.toUpperCase(),
      }),
    ).toEqual(valid);
    expect(
      generationHash(generationInput({ ...valid, title: ' セット ' })),
    ).toBe(generationHash(valid));
    expect(generationHash({ ...valid, requestedCount: 2 })).not.toBe(
      generationHash(valid),
    );
    expect(
      generationInput({ ...valid, requestedCount: 10, title: '😀'.repeat(200) })
        .requestedCount,
    ).toBe(10);
    expect(() =>
      generationConfig({ model: '', promptVersion: 'v1' }),
    ).toThrow();
  });
});
describe('provider result validation', () => {
  it('marks only exact nonempty quotes as matched and retains unmatched drafts', () => {
    expect(validateGeneration(output(), 1, sourceText)[0]?.quoteVerified).toBe(
      true,
    );
    expect(validateGeneration(output(), 1, '別の教材')[0]?.quoteVerified).toBe(
      false,
    );
  });
  it.each([
    { questions: [] },
    { questions: [candidate(), candidate()] },
    { questions: [{ ...candidate(), body: ' ' }] },
    { questions: [{ ...candidate(), explanation: 1 }] },
    { questions: [{ ...candidate(), quote: '' }] },
    { questions: [{ ...candidate(), quote: 'x'.repeat(10001) }] },
    { questions: [{ ...candidate(), choices: [{ id: 'a', label: 'A' }] }] },
    {
      questions: [
        {
          ...candidate(),
          choices: Array.from({ length: 7 }, (_, index) => ({
            id: String(index),
            label: 'A',
          })),
        },
      ],
    },
    {
      questions: [
        {
          ...candidate(),
          choices: [
            { id: 'a', label: 'A' },
            { id: 'a', label: 'B' },
          ],
        },
      ],
    },
    {
      questions: [
        {
          ...candidate(),
          choices: [
            { id: 'a', label: '' },
            { id: 'b', label: 'B' },
          ],
        },
      ],
    },
    { questions: [{ ...candidate(), answerIds: [] }] },
    { questions: [{ ...candidate(), answerIds: ['z'] }] },
    { questions: [{ ...candidate(), answerIds: ['a', 'a'] }] },
    { questions: [{ ...candidate(), reviewedBy: 1 }] },
  ])('rejects invalid result %#', (value) =>
    expect(() => validateGeneration(value, 1, sourceText)).toThrow(
      GenerationError,
    ),
  );
  it('bounds the total encoded result size', () => {
    const large = {
      questions: Array.from({ length: 10 }, () => ({
        ...candidate(),
        body: 'x'.repeat(10000),
        explanation: 'x'.repeat(10000),
        quote: 'x'.repeat(10000),
      })),
    };
    expect(() => validateGeneration(large, 10, sourceText)).toThrow();
  });
  it('exposes only fixed domain error codes', () => {
    expect(new GenerationError('storage').message).toBe('generation_storage');
  });
});
