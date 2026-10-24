import test from 'node:test';
import assert from 'node:assert/strict';
import { createApprovalPrototype } from './takt-approval.mjs';
const context = () => ({ task: 'issue-5', cwd: '/work/issue-5', toolName: 'Bash', input: { command: 'example only', nested: { value: 1 } } });
const allow = request => ({ choice: 'allow', request });
test('only matching explicit trusted decision allows the original input', async () => {
  const result = await createApprovalPrototype({ trustedDecision: allow })(context());
  assert.deepEqual(result, { behavior: 'allow', updatedInput: context().input });
});
test('missing transport, no answer, explicit deny, rejection fail closed', async () => {
  for (const trustedDecision of [undefined, () => undefined, request => ({ choice: 'deny', request }), () => { throw Error('offline'); }]) {
    assert.equal((await createApprovalPrototype({ trustedDecision })(context())).behavior, 'deny');
  }
});
test('each bound field rejects tampering', async () => {
  for (const field of ['id', 'task', 'cwd', 'toolName', 'input', 'expiresAt']) {
    const requestApproval = createApprovalPrototype({ trustedDecision: request => allow({ ...request, [field]: 'changed' }) });
    assert.equal((await requestApproval(context())).behavior, 'deny', field);
  }
});
test('replay of a previously accepted decision is denied', async () => {
  let saved;
  const requestApproval = createApprovalPrototype({ trustedDecision: request => saved ??= allow(request) });
  assert.equal((await requestApproval(context())).behavior, 'allow');
  assert.equal((await requestApproval(context())).behavior, 'deny');
});
test('timeout denies a silent UI and late allow cannot reverse it', async () => {
  let respond;
  const result = await createApprovalPrototype({ timeoutMs: 10, trustedDecision: request => new Promise(resolve => { respond = () => resolve(allow(request)); }) })(context());
  assert.equal(result.behavior, 'deny');
  respond();
  await Promise.resolve();
  assert.equal(result.behavior, 'deny');
});
test('abort before and while waiting denies', async () => {
  const controller = new AbortController();
  let calls = 0;
  const requestApproval = createApprovalPrototype({ trustedDecision: () => { calls++; return new Promise(() => {}); } });
  const pending = requestApproval({ ...context(), signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  assert.equal((await pending).behavior, 'deny');
  assert.equal((await requestApproval({ ...context(), signal: controller.signal })).behavior, 'deny');
  assert.equal(calls, 1);
});
test('input mutation after request cannot alter original binding', async () => {
  const c = context();
  const pending = createApprovalPrototype({ trustedDecision: allow })(c);
  c.input.nested.value = 2;
  assert.equal((await pending).updatedInput.nested.value, 1);
});
test('unsupported input and nonabsolute cwd fail closed', async () => {
  const requestApproval = createApprovalPrototype({ trustedDecision: allow });
  for (const patch of [{ input: undefined }, { input: { value: NaN } }, { cwd: 'relative' }]) {
    assert.equal((await requestApproval({ ...context(), ...patch })).behavior, 'deny');
  }
});
