import { SourceError } from '../source-errors';
function record(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new SourceError('invalid');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, optional = false) {
  if (optional && value === undefined) return '';
  if (
    typeof value !== 'string' ||
    value.length > max * 2 ||
    [...value].length > max ||
    (!optional && !value.trim())
  )
    throw new SourceError('invalid');
  return value.trim();
}
export function pastQuestion(value: unknown, revision = false) {
  const q = record(value, [
    'questionNumber',
    'body',
    'choices',
    'answerIds',
    'explanation',
    ...(revision ? ['originalQuestionVersionId'] : []),
  ]);
  if (!Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 6)
    throw new SourceError('invalid');
  const choices = q.choices.map((value) => {
    const c = record(value, ['id', 'label']);
    const id = text(c.id, 40);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new SourceError('invalid');
    return { id, label: text(c.label, 2000) };
  });
  const ids = new Set(choices.map((c) => c.id));
  if (
    ids.size !== choices.length ||
    !Array.isArray(q.answerIds) ||
    !q.answerIds.length ||
    q.answerIds.length > choices.length ||
    q.answerIds.some((id) => typeof id !== 'string' || !ids.has(id)) ||
    new Set(q.answerIds).size !== q.answerIds.length
  )
    throw new SourceError('invalid');
  if (
    q.originalQuestionVersionId !== undefined &&
    (typeof q.originalQuestionVersionId !== 'number' ||
      !Number.isSafeInteger(q.originalQuestionVersionId) ||
      q.originalQuestionVersionId < 1)
  )
    throw new SourceError('invalid');
  return {
    ...(q.originalQuestionVersionId === undefined
      ? {}
      : { originalQuestionVersionId: q.originalQuestionVersionId as number }),
    questionNumber: text(q.questionNumber, 40),
    body: text(q.body, 10000),
    choices,
    answerIds: [...(q.answerIds as string[])].sort(),
    explanation: text(q.explanation, 10000, true),
  };
}
export function pastExamInput(value: unknown, revision = false) {
  const input = record(value, [
    'examName',
    'year',
    'subject',
    'sourceReference',
    'questions',
    'confirmed',
    ...(revision ? ['revision'] : []),
  ]);
  if (
    input.confirmed !== true ||
    !Array.isArray(input.questions) ||
    input.questions.length < 1 ||
    input.questions.length > 100
  )
    throw new SourceError('invalid');
  if (
    revision &&
    (typeof input.revision !== 'number' ||
      !Number.isSafeInteger(input.revision) ||
      input.revision < 0)
  )
    throw new SourceError('invalid');
  const questions = input.questions.map((q) => pastQuestion(q, revision));
  if (new Set(questions.map((q) => q.questionNumber)).size !== questions.length)
    throw new SourceError('invalid');
  const originals = questions.flatMap((q) =>
    q.originalQuestionVersionId === undefined
      ? []
      : [q.originalQuestionVersionId],
  );
  if (new Set(originals).size !== originals.length)
    throw new SourceError('invalid');
  const result = {
    examName: text(input.examName, 100),
    year: text(input.year, 40),
    subject: text(input.subject, 100),
    sourceReference: text(input.sourceReference, 2000, true),
    questions,
    ...(revision ? { revision: input.revision as number } : {}),
  };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 256 * 1024)
    throw new SourceError('invalid');
  return result;
}
