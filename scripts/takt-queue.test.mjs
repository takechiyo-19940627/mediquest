import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverPackage, issueOptions, prOptions, retryAttempt, withQueueLock } from './takt-queue.mjs';

test('retry allows only two additional attempts and excludes publication failure', () => {
  assert.equal(retryAttempt({ status: 'failed' }), 2);
  assert.equal(retryAttempt({ status: 'exceeded' }, 2), 3);
  assert.throws(() => retryAttempt({ status: 'failed' }, 3), /limit/);
  for (const status of ['pending', 'running', 'completed', 'pr_failed']) assert.throws(() => retryAttempt({ status }));
});

test('PR repair requires verified same-repository branch and review identity', () => {
  const pr = { number: 7, title: 'Repair', body: 'Fix reviewed issue', state: 'OPEN', isCrossRepository: false, headRefOid: 'a'.repeat(40), reviewFingerprint: 'b'.repeat(64), headRefName: 'codex/issue-7', baseRefName: 'main' };
  assert.equal(prOptions(pr).should_publish_branch_to_origin, true);
  assert.equal(prOptions(pr).auto_pr, false);
  for (const patch of [{ isCrossRepository: true }, { headRefName: '--bad' }, { headRefName: 'main' }, { reviewFingerprint: '' }, { state: 'MERGED' }]) assert.throws(() => prOptions({ ...pr, ...patch }));
});

test('issue input requires an open issue and safe positive number', () => {
  for (const issue of [{}, { number: -1, title: 'x', body: '', state: 'OPEN' }, { number: 1, title: 'x', body: '', state: 'CLOSED' }]) assert.throws(() => issueOptions(issue));
  assert.equal(issueOptions({ number: 1, title: 'a $(echo b)', body: '', state: 'OPEN' }).branch, 'codex/issue-1');
});

test('queue lock excludes simultaneous writers and releases after error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'takt-lock-test-'));
  try {
    await withQueueLock(root, async () => {
      await assert.rejects(withQueueLock(root, () => assert.fail('second owner acquired')), /Queue locked/);
    });
    await assert.rejects(withQueueLock(root, () => { throw new Error('operation failed'); }), /operation failed/);
    await withQueueLock(root, () => {});
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('stale/ownerless lock is never silently stolen', async () => {
  const root = await mkdtemp(join(tmpdir(), 'takt-lock-test-'));
  try {
    await mkdir(join(root, '.takt/supervisor-queue.lock'), { recursive: true });
    await assert.rejects(withQueueLock(root, () => assert.fail('stolen')), /Never automatically delete/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('package discovery resolves nodenv explicitly rather than ambient npm', () => {
  const calls = [];
  const env = { NODENV_VERSION: '20.19.0' };
  assert.equal(discoverPackage(env, (cmd, args, options) => {
    calls.push([cmd, args]);
    assert.equal(options.env, env);
    return args[0] === '--version' ? 'nodenv' : '/selected/lib/node_modules';
  }), '/selected/lib/node_modules/takt');
  assert.deepEqual(calls[1], ['nodenv', ['exec', 'npm', 'root', '-g']]);
});
test('package discovery only falls back when nodenv is absent', () => {
  assert.equal(discoverPackage({}, (cmd) => {
    if (cmd === 'nodenv') throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return '/fallback/lib/node_modules';
  }), '/fallback/lib/node_modules/takt');
  assert.throws(() => discoverPackage({}, () => { throw new Error('broken configuration'); }), /broken configuration/);
});
