import { createAnthropicProvider } from './anthropic';
export function createProvider(
  apiKey: string,
  signal: AbortSignal,
  workspaceId?: string,
) {
  return createAnthropicProvider(apiKey, signal, globalThis.fetch, workspaceId);
}
