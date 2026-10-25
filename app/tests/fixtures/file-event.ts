import { readFileSync } from 'node:fs';
// Observe a request-specific event, including events written before observation starts.
// The file is re-read on a fixed interval instead of fs.watchFile: watchFile only
// reports changes against a baseline stat taken asynchronously after registration,
// so writes landing before that baseline (e.g. under threadpool load) were never seen.
export function waitForFileEvent(
  file: string,
  event: string,
  signal: AbortSignal,
  deadlineMs = 10000,
  intervalMs = 20,
) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
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
    const poll = setInterval(check, intervalMs);
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
