// TEST_ONLY_GENERATION_TRANSPORT_MARKER: this module must never be present in production output.
import { setTimeout as delay } from 'node:timers/promises';
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
      const token = /SCENARIO_PENDING(?:_DELAYED)?:([a-f0-9-]+)/.exec(
        data.sourceText,
      )?.[1];
      // Regression fixture: dispatch intentionally exceeds the former implicit 1s poll deadline.
      if (data.sourceText.includes('SCENARIO_PENDING_DELAYED'))
        await delay(1100, undefined, { signal: init.signal ?? undefined });
      appendFileSync(events, token ? `called:${token}\n` : 'called\n');
      if (data.sourceText.includes('SCENARIO_PENDING')) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            clearInterval(timer);
            appendFileSync(events, `aborted:${token}\n`);
            reject(new Error('test aborted'));
          };
          const timer = setInterval(() => {
            if (existsSync(`${events}.${token}.release`)) {
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
