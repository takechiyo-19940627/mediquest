import test from 'node:test';
import assert from 'node:assert/strict';
import { scopedCodexArguments } from './codex-scoped.mjs';
const input = ['exec', '--json', '--sandbox', 'workspace-write', '--cd', '/tmp/fixture', '--config', 'sandbox_workspace_write.network_access=false'];
test('Codex edit translates to scoped workspace profile with network/approval denied', () => {
  const { args, profile } = scopedCodexArguments(input);
  assert.equal(profile.extends, ':workspace');
  assert.equal(profile.network.enabled, false);
  assert(args.includes('approval_policy="never"'));
  assert(args.includes('--ignore-user-config'));
  assert(args.includes('--ignore-rules'));
  assert(!args.includes('--sandbox'));
  assert(!args.some(arg => arg.startsWith('sandbox_workspace_write')));
  for (const path of ['scripts', '.takt', '.claude', 'docs']) assert.equal(profile.filesystem[':workspace_roots'][path], 'read');
  for (const path of ['app/.env', 'app/.env.*']) assert.equal(profile.filesystem[':workspace_roots'][path], 'deny');
  assert.equal(profile.filesystem['~/.codex'], 'deny');
  assert.equal(scopedCodexArguments(input.map(x => x === 'workspace-write' ? 'read-only' : x)).profile.extends, ':read-only');
});
test('unexpected privilege/network/config/cwd overrides fail closed', () => {
  for (const args of [input.map(x => x === 'workspace-write' ? 'danger-full-access' : x), [...input, '--add-dir', '/'], [...input, '--config', 'approval_policy="never"'], [...input, '--config', 'sandbox_workspace_write.network_access=true'], [...input, '--sandbox', 'read-only'], [...input, '--dangerously-bypass-approvals-and-sandbox']]) assert.throws(() => scopedCodexArguments(args));
});

 test('Codex requires the real Git worktree root and rejects subdirectories', async t => {
  const { mkdtempSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { assertWorktreeRoot } = await import('./codex-scoped.mjs');
  const root = mkdtempSync(join(tmpdir(), 'codex-root-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => assertWorktreeRoot(root));
  execFileSync('git', ['init', '-q', root]);
  mkdirSync(join(root, 'app'));
  assert.doesNotThrow(() => assertWorktreeRoot(root));
  assert.throws(() => assertWorktreeRoot(join(root, 'app')), /worktree root/);
});
