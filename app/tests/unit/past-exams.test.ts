import { expect, it } from 'vitest';
import { pastExamInput } from '../../server/services/past-exams/input';
import { pastExamInputFixture } from '../fixtures/past-exams';
it('accepts optional explanation/reference, trims metadata, and requires confirmed structured questions', () => {
  const body = pastExamInputFixture();
  expect(
    pastExamInput({
      ...body,
      examName: ' 試験 ',
      sourceReference: undefined,
      questions: [{ ...body.questions[0]!, explanation: undefined }],
    }),
  ).toMatchObject({
    examName: '試験',
    sourceReference: '',
    questions: [expect.objectContaining({ explanation: '' })],
  });
  const q = body.questions[0]!;
  for (const changed of [
    { confirmed: false },
    { confirmed: 'true' },
    { year: '' },
    { examName: 'a'.repeat(101) },
    { questions: [] },
    { questions: pastExamInputFixture(101).questions },
    { questions: [q, q] },
    { questions: [{ ...q, questionNumber: '' }] },
    { questions: [{ ...q, choices: [q.choices[0]] }] },
    { questions: [{ ...q, answerIds: [] }] },
    { questions: [{ ...q, answerIds: ['z'] }] },
    { questions: [{ ...q, answerIds: ['a', 'a'] }] },
    { questions: [{ ...q, choices: [q.choices[0], q.choices[0]] }] },
    { questions: [{ ...q, quote: 'invented' }] },
    { questions: [{ ...q, body: 'a'.repeat(10001) }] },
    { questions: [{ ...q, explanation: null }] },
    { requestedBy: 99 },
    { revision: 0 },
  ])
    expect(() => pastExamInput({ ...body, ...changed })).toThrow('invalid');
  expect(() => pastExamInput({ ...body, revision: -1 }, true)).toThrow(
    'invalid',
  );
  expect(() => pastExamInput(body, true)).toThrow('invalid');
  expect(pastExamInput({ ...body, revision: 0 }, true).revision).toBe(0);
  expect(() =>
    pastExamInput({
      ...pastExamInputFixture(100),
      questions: pastExamInputFixture(100).questions.map((q) => ({
        ...q,
        body: 'a'.repeat(10000),
      })),
    }),
  ).toThrow('invalid');
});
