export type GenerationErrorCode =
  'invalid' | 'forbidden' | 'missing' | 'conflict' | 'storage';
export class GenerationError extends Error {
  constructor(public readonly code: GenerationErrorCode) {
    super(`generation_${code}`);
  }
}
export interface GenerationConfig {
  model: string;
  promptVersion: string;
}
export interface GenerationProviderInput extends GenerationConfig {
  sourceText: string;
  requestedCount: number;
}
export type GenerationOutcome =
  | { kind: 'success'; output: unknown }
  | { kind: 'failed' }
  | { kind: 'unknown' };
export type GenerationProvider = (
  input: GenerationProviderInput,
) => Promise<GenerationOutcome>;
export interface GeneratedQuestion {
  body: string;
  choices: { id: string; label: string }[];
  answerIds: string[];
  explanation: string;
  quote: string;
  quoteVerified: boolean;
}
