/** Offline prototype only. The caller must supply a separately trusted UI callback.
 * This module establishes no OS security boundary and is not wired into TAKT. */
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonical).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  throw new TypeError('Only plain JSON inputs are supported');
}
const deny = reason => ({ behavior: 'deny', message: reason });

export function createApprovalPrototype({ trustedDecision, timeoutMs = 30_000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new TypeError('Invalid timeout');
  // IDs are fresh per call; a decision is accepted only by that call's closure.
  return async function requestApproval({ task, cwd, toolName, input, signal } = {}) {
    if (!task || typeof task !== 'string' || typeof cwd !== 'string' || !isAbsolute(cwd) || !toolName || typeof toolName !== 'string') return deny('Invalid context');
    if (typeof trustedDecision !== 'function') return deny('No trusted decision transport');
    if (signal?.aborted) return deny('Aborted');
    let request;
    try {
      request = JSON.parse(canonical({ id: randomUUID(), task, cwd, toolName, input, expiresAt: Date.now() + timeoutMs }));
    } catch { return deny('Invalid JSON input'); }
    const binding = canonical(request);
    return new Promise(resolve => {
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        resolve(result);
      };
      const abort = () => finish(deny('Aborted'));
      const timer = setTimeout(() => finish(deny('Approval expired')), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      // Separate copy: UI mutation cannot change the bound execution input.
      Promise.resolve().then(() => {
        if (settled || signal?.aborted) return undefined;
        return trustedDecision(JSON.parse(binding));
      }).then(decision => {
        if (settled) return;
        if (signal?.aborted) return finish(deny('Aborted'));
        if (Date.now() >= request.expiresAt) return finish(deny('Approval expired'));
        try {
          if (!decision || decision.choice !== 'allow' || canonical(decision.request) !== binding) return finish(deny('No matching explicit approval'));
          finish({ behavior: 'allow', updatedInput: request.input });
        } catch { finish(deny('Invalid decision')); }
      }, () => finish(deny('Decision transport failed')));
    });
  };
}
