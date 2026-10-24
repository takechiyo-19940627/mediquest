import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { waitForFileEvent } from '../fixtures/file-event';
it('observes only the matching request, including a pre-existing event, and cancels outstanding observation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'file-event-'));
  const file = join(dir, 'events');
  writeFileSync(file, 'called:old\n');
  const controller = new AbortController();
  try {
    await waitForFileEvent(file, 'called:old', controller.signal);
    let observed = false;
    const pending = waitForFileEvent(
      file,
      'called:new',
      controller.signal,
    ).then(() => {
      observed = true;
    });
    appendFileSync(file, 'called:other\n');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(observed).toBe(false);
    appendFileSync(file, 'called:new\n');
    await pending;
    expect(observed).toBe(true);
    const cancelled = waitForFileEvent(file, 'never', controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toThrow('aborted');
    await expect(
      waitForFileEvent(file, 'never', new AbortController().signal, 1),
    ).rejects.toThrow('deadline');
  } finally {
    controller.abort();
    rmSync(dir, { recursive: true, force: true });
  }
});
