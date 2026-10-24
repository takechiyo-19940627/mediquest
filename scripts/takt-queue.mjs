#!/usr/bin/env node
// Version-pinned adapter: all queue writers/runners must use this wrapper.
import { mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export async function withQueueLock(root, operation) {
  const path = join(root, '.takt', 'supervisor-queue.lock');
  await mkdir(dirname(path), { recursive: true });
  try { await mkdir(path); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Queue locked: ${path}. Inspect owner.json and running processes. Never automatically delete a stale lock.`);
    throw error;
  }
  const token = randomUUID();
  await writeFile(join(path, 'owner.json'), JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }));
  try { return await operation(); }
  finally {
    const owner = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'));
    if (owner.token !== token) throw new Error('Queue lock ownership changed; refusing cleanup');
    await rm(path, { recursive: true });
  }
}

export function issueOptions(issue, workflow = 'mediquest-app') {
  if (!Number.isSafeInteger(issue.number) || issue.number < 1 || typeof issue.title !== 'string' || !issue.title.trim() || typeof issue.body !== 'string' || issue.state !== 'OPEN') {
    throw new Error('Expected gh issue view JSON with number, title, body, state: OPEN');
  }
  return {
    slug: `issue-${issue.number}`, summary: issue.title,
    workflow, worktree: true, branch: `codex/issue-${issue.number}`,
    base_branch: 'origin/main', issue: issue.number, source: 'issue',
    auto_pr: true, draft_pr: true,
  };
}

export function prOptions(pr) {
  if (!Number.isSafeInteger(pr.number) || pr.number < 1 || typeof pr.title !== 'string' || !pr.title.trim() || typeof pr.body !== 'string' || !pr.body.trim() || pr.state !== 'OPEN' || pr.isCrossRepository !== false || !/^[a-f0-9]{40}$/.test(pr.headRefOid ?? '') || typeof pr.reviewFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(pr.reviewFingerprint)) throw new Error('Expected verified same-repository open PR, headRefOid, reviewFingerprint SHA256, title and review instructions in body');
  for (const name of [pr.headRefName, pr.baseRefName]) {
    if (typeof name !== 'string' || !name || name.startsWith('-')) throw new Error('Invalid PR branch');
    execFileSync('git', ['check-ref-format', '--branch', name], { stdio: 'pipe' });
  }
  if (pr.headRefName === pr.baseRefName) throw new Error('PR head and base must differ');
  return { slug: `pr-${pr.number}-${pr.reviewFingerprint.slice(0, 16)}`, summary: pr.title,
    workflow: 'mediquest-app', worktree: true, branch: pr.headRefName, base_branch: pr.baseRefName,
    source: 'pr_review', pr_number: pr.number, auto_pr: false, should_publish_branch_to_origin: true };
}

export function retryAttempt(task, attempts) {
  if (!task || !['failed', 'exceeded'].includes(task.status)) throw new Error('Only failed/exceeded tasks can retry; reconcile PR publication failures separately');
  const used = attempts ?? 1;
  if (!Number.isInteger(used) || used < 1 || used >= 3) throw new Error('Task attempt limit (3 total attempts) reached or invalid state');
  return used + 1;
}

export function discoverPackage(env, execute = execFileSync) {
  let hasNodenv = true;
  try { execute('nodenv', ['--version'], { env, stdio: 'pipe' }); }
  catch (error) { if (error.code === 'ENOENT') hasNodenv = false; else throw error; }
  const npmRoot = execute(hasNodenv ? 'nodenv' : 'npm', hasNodenv ? ['exec', 'npm', 'root', '-g'] : ['root', '-g'], { env, encoding: 'utf8' }).trim();
  return join(npmRoot, 'takt');
}

async function loadRunner(root) {
  const expected = (await readFile(join(root, '.takt/version'), 'utf8')).trim();
  const env = { ...process.env, NODENV_VERSION: process.env.TAKT_NODE_VERSION ?? '20.19.0' };
  let packageDir = process.env.TAKT_PACKAGE_DIR;
  if (!packageDir) {
    packageDir = discoverPackage(env);
  }
  packageDir = resolve(packageDir);
  const installed = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
  if (expected !== '0.49.0' || installed.version !== expected || installed.name !== 'takt') throw new Error('Queue adapter requires TAKT 0.49.0; audit adapter before upgrading');
  const { TaskRunner } = await import(pathToFileURL(join(packageDir, 'dist/infra/task/runner.js')).href);
  const { TasksFileSchema } = await import(pathToFileURL(join(packageDir, 'dist/infra/task/schema.js')).href);
  const { parse } = await import(pathToFileURL(join(packageDir, 'node_modules/yaml/dist/index.js')).href);
  const snapshot = async () => {
    const file = join(root, '.takt/tasks.yaml');
    return existsSync(file) ? TasksFileSchema.parse(parse(await readFile(file, 'utf8'))) : { tasks: [] };
  };
  return { runner: new TaskRunner(root), snapshot, packageDir };
}

export async function main(args, root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const [command, file] = args;
  const arity = { inspect: 1, 'enqueue-issue': 2, 'enqueue-pr': 2, retry: 3, run: 1 };
  if (args.length !== arity[command]) throw new Error('Usage: node scripts/takt-queue.mjs inspect | enqueue-issue <issue.json> | enqueue-pr <pr.json> | retry <task-name> <note-file> | run');
  // TAKT replaces this file atomically; a read-only snapshot can run during work.
  if (command === 'inspect') {
    const { snapshot } = await loadRunner(root);
    console.log(JSON.stringify(await snapshot(), null, 2));
    return;
  }
  return withQueueLock(root, async () => {
    const { runner, snapshot, packageDir } = await loadRunner(root);
    const before = await snapshot();
    // Fail closed for manual TAKT processes that did not acquire our lock.
    if (command !== 'inspect' && before.tasks.some(task => task.status === 'running')) throw new Error('Existing running task requires reconciliation before queue mutation/run');
    const pending = before.tasks.filter(task => task.status === 'pending').length;
    if ((command === 'run' && pending > 2) || (command !== 'run' && pending >= 2)) throw new Error('Pending batch cap is 2; run/reconcile current batch first');
    if (command === 'retry') {
      const task = before.tasks.find(task => task.name === file);
      const note = (await readFile(resolve(args[2]), 'utf8')).trim();
      if (!note) throw new Error('Retry requires a nonempty investigation/improvement note');
      const stateFile = join(root, '.takt/supervisor-retries.json');
      const state = existsSync(stateFile) ? JSON.parse(await readFile(stateFile, 'utf8')) : { attempts: {} };
      if (!state.attempts || typeof state.attempts !== 'object' || Array.isArray(state.attempts)) throw new Error('Invalid retry state');
      const attempt = retryAttempt(task, Object.hasOwn(state.attempts, file) ? state.attempts[file] : undefined);
      // Reserve before mutating TAKT. A crash can consume an attempt but cannot bypass cap.
      Object.defineProperty(state.attempts, file, { value: attempt, writable: true, enumerable: true, configurable: true });
      const temp = `${stateFile}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(state, null, 2)); await rename(temp, stateFile);
      runner.requeueTask(file, ['failed', 'exceeded'], undefined, note);
      console.log(JSON.stringify({ requeued: file, attempt }));
      return;
    }
    if (command === 'enqueue-pr') {
      const pr = JSON.parse(await readFile(resolve(file), 'utf8'));
      const options = prOptions(pr);
      if (before.tasks.some(task => task.pr_number === pr.number && (['pending', 'running', 'failed', 'exceeded', 'pr_failed'].includes(task.status) || task.slug === options.slug))) throw new Error('PR has an unfinished task or this review was already handled; inspect/retry');
      const task = runner.addTask(`# PR ${pr.number}: ${pr.title}\nExpected head: ${pr.headRefOid}\nReview fingerprint: ${pr.reviewFingerprint}\n\n${pr.body}`, options);
      console.log(JSON.stringify({ enqueued: task.name, pr: pr.number }));
      return;
    }
    if (command === 'enqueue-issue') {
      const issue = JSON.parse(await readFile(resolve(file), 'utf8'));
      const options = issueOptions(issue);
      if (before.tasks.some(task => task.issue === issue.number)) throw new Error(`Issue #${issue.number} already has a task; inspect/retry it instead of duplicating`);
      const task = runner.addTask(`# Issue ${issue.number}: ${issue.title}\n\n${issue.body}`, options);
      console.log(JSON.stringify({ enqueued: task.name, issue: issue.number }));
      return;
    }
    const code = await new Promise((resolveExit, reject) => {
      const child = spawn('bash', ['scripts/takt.sh', 'run'], { cwd: root, stdio: 'inherit', env: { ...process.env, TAKT_PACKAGE_DIR: packageDir } });
      // Retain lock until child exits even if supervisor is interrupted.
      const interrupt = () => child.kill('SIGINT');
      process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
      const cleanup = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); };
      child.once('error', error => { cleanup(); reject(error); });
      child.once('exit', (exitCode, signal) => { cleanup(); resolveExit(signal ? 130 : exitCode ?? 1); });
    });
    const after = await snapshot();
    console.log(JSON.stringify(after, null, 2));
    const prior = new Map(before.tasks.map(task => [task.name, JSON.stringify(task)]));
    const changed = after.tasks.filter(task => prior.get(task.name) !== JSON.stringify(task));
    if (code !== 0 || changed.some(task => task.status !== 'completed') || after.tasks.some(task => ['pending', 'running'].includes(task.status))) throw new Error('TAKT run incomplete or failed; inspect task states and reports');
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
