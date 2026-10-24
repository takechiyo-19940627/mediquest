// TEST_ONLY_GENERATION_TRANSPORT_MARKER: this module must never be present in production output.
import { appendFileSync, existsSync } from 'node:fs';
import { createAnthropicProvider } from '../../server/services/generation/anthropic';
import { output } from './generation';

export function createProvider(
  key: string,
  signal: AbortSignal,
  workspaceId?: string,
) {
  return createAnthropicProvider(
    key,
    signal,
    async (_url, init) => {
      const events = process.env.TEST_GENERATION_EVENTS!;
      const data = JSON.parse(
        JSON.parse(init.body as string).messages[0].content[0].text,
      );
      appendFileSync(events, 'called\n');
      if (data.sourceText.includes('SCENARIO_PENDING')) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            clearInterval(timer);
            appendFileSync(events, 'aborted\n');
            reject(new Error('test aborted'));
          };
          const timer = setInterval(() => {
            if (existsSync(`${events}.release`)) {
              clearInterval(timer);
              init.signal?.removeEventListener('abort', onAbort);
              resolve();
            }
          }, 10);
          init.signal?.addEventListener('abort', onAbort, { once: true });
          if (init.signal?.aborted) onAbort();
        });
      }
      if (data.sourceText.includes('SCENARIO_REJECT'))
        return new Response('TEST_ONLY_SECRET_ERROR', { status: 401 });
      if (data.sourceText.includes('SCENARIO_INVALID'))
        return new Response('{}');
      return new Response(
        JSON.stringify({
          type: 'message',
          role: 'assistant',
          stop_reason: 'end_turn',
          content: [
            { type: 'text', text: JSON.stringify(output(data.requestedCount)) },
          ],
        }),
      );
    },
    workspaceId,
  );
}
