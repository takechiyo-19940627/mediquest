import { readFileSync, watchFile, unwatchFile } from 'node:fs';
// Observe a request-specific event, including events written before watch registration.
export function waitForFileEvent(
  file: string,
  event: string,
  signal: AbortSignal,
  deadlineMs = 10000,
) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unwatchFile(file, check);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      try {
        if (readFileSync(file, 'utf8').split('\n').includes(event)) finish();
      } catch {
        finish(new Error('Test event read failed'));
      }
    };
    watchFile(file, { interval: 20 }, check);
    const timer = setTimeout(
      () => finish(new Error('Test provider event deadline exceeded')),
      deadlineMs,
    );
    const abort = () => finish(new Error('Test event observation aborted'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else check();
  });
}
