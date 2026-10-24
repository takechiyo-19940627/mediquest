import { createHash } from 'node:crypto';
import { GenerationError } from './contract';
import type { GeneratedQuestion, GenerationConfig } from './contract';

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new GenerationError('invalid');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max * 2 ||
    [...value].length > max
  )
    throw new GenerationError('invalid');
  return value;
}
export function generationInput(value: unknown) {
  const input = record(value, [
    'sourceId',
    'requestedCount',
    'title',
    'requestKey',
  ]);
  if (
    typeof input.sourceId !== 'number' ||
    !Number.isSafeInteger(input.sourceId) ||
    input.sourceId <= 0 ||
    typeof input.requestedCount !== 'number' ||
    !Number.isInteger(input.requestedCount) ||
    input.requestedCount < 1 ||
    input.requestedCount > 10
  )
    throw new GenerationError('invalid');
  const title = text(
    typeof input.title === 'string' ? input.title.trim() : input.title,
    200,
  );
  if (
    typeof input.requestKey !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      input.requestKey,
    )
  )
    throw new GenerationError('invalid');
  return {
    sourceId: input.sourceId,
    requestedCount: input.requestedCount,
    title,
    requestKey: input.requestKey.toLowerCase(),
  };
}
export function generationHash(input: ReturnType<typeof generationInput>) {
  return createHash('sha256')
    .update(JSON.stringify([input.sourceId, input.requestedCount, input.title]))
    .digest('hex');
}
export function generationConfig(config: GenerationConfig) {
  return {
    model: text(config.model, 200),
    promptVersion: text(config.promptVersion, 200),
  };
}
export function validateGeneration(
  value: unknown,
  requestedCount: number,
  sourceText: string,
): GeneratedQuestion[] {
  const output = record(value, ['questions']);
  if (
    !Array.isArray(output.questions) ||
    output.questions.length !== requestedCount ||
    requestedCount < 1 ||
    requestedCount > 10
  )
    throw new GenerationError('invalid');
  const questions = output.questions.map((value): GeneratedQuestion => {
    const question = record(value, [
      'body',
      'choices',
      'answerIds',
      'explanation',
      'quote',
    ]);
    if (
      !Array.isArray(question.choices) ||
      question.choices.length < 2 ||
      question.choices.length > 6
    )
      throw new GenerationError('invalid');
    const choices = question.choices.map((value) => {
      const choice = record(value, ['id', 'label']);
      const id = text(choice.id, 40);
      if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new GenerationError('invalid');
      return { id, label: text(choice.label, 2000) };
    });
    const ids = new Set(choices.map((choice) => choice.id));
    if (
      ids.size !== choices.length ||
      !Array.isArray(question.answerIds) ||
      !question.answerIds.length ||
      question.answerIds.length > choices.length ||
      question.answerIds.some((id) => typeof id !== 'string' || !ids.has(id)) ||
      new Set(question.answerIds).size !== question.answerIds.length
    )
      throw new GenerationError('invalid');
    const quote = text(question.quote, 10000);
    return {
      body: text(question.body, 10000),
      choices,
      answerIds: question.answerIds as string[],
      explanation: text(question.explanation, 10000),
      quote,
      quoteVerified: sourceText.includes(quote),
    };
  });
  if (Buffer.byteLength(JSON.stringify(questions), 'utf8') > 256 * 1024)
    throw new GenerationError('invalid');
  return questions;
}
