import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkApp, requiredScripts } from './check-app.mjs';

function fixture(t, scripts) {
  const root = mkdtempSync(join(tmpdir(), 'mediquest-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'app'));
  if (scripts !== undefined) {
    writeFileSync(join(root, 'app/package.json'), JSON.stringify({ scripts }));
  }
  return root;
}
const validScripts = Object.fromEntries(requiredScripts.map(s => [s, 'test-command']));
test('missing app cannot pass', t => {
  assert.equal(checkApp(fixture(t), () => assert.fail('must not execute')), 1);
});
test('missing required checks cannot pass', t => {
  assert.equal(checkApp(fixture(t, { lint: 'check' }), () => assert.fail('must not execute')), 1);
});
test('failed check stops later checks', t => {
  const calls = [];
  assert.equal(checkApp(fixture(t, validScripts), (cmd, args) => {
    calls.push(args[1]);
    return { status: calls.length === 2 ? 1 : 0 };
  }), 1);
  assert.deepEqual(calls, ['format:check', 'lint']);
});
test('timeout or failed process cannot pass', t => {
  assert.equal(checkApp(fixture(t, validScripts), () => ({ status: null, error: new Error('timeout') })), 1);
});
test('all required checks must execute successfully', t => {
  const calls = [];
  assert.equal(checkApp(fixture(t, validScripts), (cmd, args, options) => {
    assert.equal(cmd, 'npm');
    assert.equal(options.env.CI, 'true');
    calls.push(args[1]);
    return { status: 0 };
  }), 0);
  assert.deepEqual(calls, requiredScripts);
});

test('real npm execution propagates failure', t => {
  const scripts = Object.fromEntries(requiredScripts.map(s => [s, 'node -e "process.exit(0)"']));
  scripts.lint = 'node -e "process.exit(7)"';
  assert.equal(checkApp(fixture(t, scripts)), 1);
});
test('real npm execution passes only a full successful suite', t => {
  const scripts = Object.fromEntries(requiredScripts.map(s => [s, 'node -e "process.exit(0)"']));
  assert.equal(checkApp(fixture(t, scripts)), 0);
});
