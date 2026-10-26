// Host-only preparation; worker permissions and quality approval are unchanged.
import { spawn, execFileSync } from 'node:child_process';
import { realpathSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest('hex');
function operation(root, name, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['scripts/app-command.sh', name], { cwd: root, env: process.env, stdio: 'inherit', signal, timeout: 900_000, killSignal: 'SIGTERM' });
    child.once('error', reject);
    child.once('exit', (code, killed) => code === 0 && !killed ? resolve() : reject(new Error('operation failed')));
  });
}
export async function prepareTaskWorkspace(projectRoot, workerRoot, workflowName, signal, run = operation) {
  let record, output;
  try {
    if (workflowName !== 'mediquest-app') throw new Error('unsupported workflow');
    projectRoot = realpathSync(projectRoot); workerRoot = realpathSync(workerRoot);
    const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    if (realpathSync(git(workerRoot, ['rev-parse', '--show-toplevel'])) !== workerRoot ||
        realpathSync(git(projectRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'])) !== realpathSync(git(workerRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']))) throw new Error('unrelated workspace');
    const launcher = 'scripts/app-command.sh';
    if (hash(readFileSync(join(projectRoot, launcher))) !== hash(readFileSync(join(workerRoot, launcher)))) throw new Error('unreviewed launcher');
    const source = () => hash(Buffer.concat([readFileSync(join(workerRoot, 'app/package.json')), readFileSync(join(workerRoot, 'app/package-lock.json'))]));
    const dir = join(workerRoot, '.takt/preparation'); mkdirSync(dir, { recursive: true });
    output = join(dir, `${randomUUID()}.json`);
    record = { root: workerRoot, startedAt: new Date().toISOString(), status: 'running', manifestHash: source(), operations: [] };
    writeFileSync(output, JSON.stringify(record));
    // Always prepare each invocation, including start_step/directResume. No stale cache approval.
    for (const name of ['ci', 'browser:install']) {
      if (signal?.aborted) throw new Error('aborted');
      await run(workerRoot, name, signal);
      record.operations.push(name);
    }
    if (signal?.aborted || source() !== record.manifestHash) throw new Error('manifest changed');
    record.status = 'prepared'; record.finishedAt = new Date().toISOString();
    writeFileSync(output, JSON.stringify(record));
  } catch {
    if (record && output) { record.status = 'failed'; writeFileSync(output, JSON.stringify(record)); }
    throw new Error('[host_preparation_failed] Approved dependency/browser preparation failed; model execution not started');
  }
}
