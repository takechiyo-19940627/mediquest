import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverPackage, issueOptions, prOptions, repairLegacyIssueBase, retryAttempt, verifyFreshMain, withQueueLock } from './takt-queue.mjs';

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


test('issue base is a branch name accepted by TAKT, never a remote-tracking ref', () => {
  assert.equal(issueOptions({ number: 5, title: 'Bootstrap', body: '', state: 'OPEN' }).base_branch, 'main');
});

test('retry repairs only legacy issue base and preserves task identity and history', () => {
  const original = { name: 'issue-5', source: 'issue', issue: 5, status: 'failed', base_branch: 'origin/main', branch: 'codex/issue-5', failure: { message: 'base rejected' } };
  let state = { tasks: [original, { ...original, name: 'issue-6' }, { ...original, name: 'pr-7', source: 'pr_review' }] };
  const store = { update: fn => { state = fn(state); return state; } };
  repairLegacyIssueBase(store, 'issue-5');
  assert.deepEqual(state.tasks[0], { ...original, base_branch: 'main' });
  assert.equal(state.tasks[1].base_branch, 'origin/main');
  repairLegacyIssueBase(store, 'pr-7');
  assert.equal(state.tasks[2].base_branch, 'origin/main');
  state.tasks[0] = { ...original, status: 'running' };
  assert.throws(() => repairLegacyIssueBase(store, 'issue-5'), /failed\/exceeded/);
});


test('run freshness rejects fetch failure and stale local main without modifying branches', () => {
  assert.throws(() => verifyFreshMain('/repo', () => { throw new Error('fetch failed'); }), /fetch failed/);
  const calls = [];
  assert.throws(() => verifyFreshMain('/repo', (cmd, args) => {
    calls.push(args);
    return args.includes('refs/heads/main') ? 'old' : 'new';
  }), /Local main differs/);
  assert.equal(calls.length, 3);
  assert.equal(verifyFreshMain('/repo', () => 'same'), 'same');
  assert.equal(verifyFreshMain('/repo', (cmd, args) => {
    if (args.includes('refs/heads/main')) throw Object.assign(new Error('absent'), { status: 128 });
    return 'remote';
  }), 'remote');
});
