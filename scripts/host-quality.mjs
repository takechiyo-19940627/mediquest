import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, lstatSync, readlinkSync, realpathSync, renameSync, openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requiredScripts } from './check-app.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');
export function sourceSnapshot(root) {
  const files = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
  const hash = createHash('sha256');
  for (const name of [...new Set(files)].sort()) {
    hash.update(JSON.stringify(name));
    const file = join(root, name);
    let stat;
    try { stat = lstatSync(file); } catch (error) { if (error.code === 'ENOENT') { hash.update('deleted'); continue; } throw error; }
    hash.update(String(stat.mode));
    if (stat.isSymbolicLink()) hash.update(`link:${readlinkSync(file)}`);
    else if (stat.isFile()) hash.update(readFileSync(file));
    else throw new Error('Unsupported source entry');
  }
  return hash.digest('hex');
}
function save(dir, record) {
  const text = JSON.stringify(record, null, 2) + '\n';
  writeFileSync(join(dir, `${record.attemptId}.json`), text);
  const temp = join(dir, 'latest.tmp');
  writeFileSync(temp, text);
  renameSync(temp, join(dir, 'latest.json'));
}
export function runHostQuality(root, run = spawnSync) {
  root = realpathSync(root);
  const dir = join(root, '.takt/quality');
  mkdirSync(dir, { recursive: true });
  const record = { attemptId: randomUUID(), root, startedAt: new Date().toISOString(), status: 'running', checks: [...requiredScripts] };
  save(dir, record); // invalidate prior success before any fallible snapshot/run operation
  try {
    record.snapshot = sourceSnapshot(root);
    record.log = `.takt/quality/${record.attemptId}.log`;
    const fd = openSync(join(root, record.log), 'wx');
    let result;
    try { result = run(process.execPath, [join(root, 'scripts/check-app.mjs')], { cwd: root, env: process.env, stdio: ['ignore', fd, fd], timeout: 2_200_000 }); }
    finally { closeSync(fd); }
    record.logHash = digest(readFileSync(join(root, record.log)));
    record.exitCode = result.status;
    record.status = !result.error && result.status === 0 && sourceSnapshot(root) === record.snapshot ? 'passed' : 'failed';
  } catch { record.status = 'failed'; }
  record.finishedAt = new Date().toISOString();
  save(dir, record);
  console.log(`Host quality ${record.status}; evidence: .takt/quality/latest.json; attempt: ${record.attemptId}`);
  return record.status === 'passed' ? 0 : 1;
}
export function verifyHostQuality(root) {
  try {
    root = realpathSync(root);
    const record = JSON.parse(readFileSync(join(root, '.takt/quality/latest.json')));
    return record.status === 'passed' && record.root === root && record.exitCode === 0 &&
      JSON.stringify(record.checks) === JSON.stringify(requiredScripts) &&
      /^[0-9a-f-]{36}$/.test(record.attemptId) && record.log === `.takt/quality/${record.attemptId}.log` &&
      record.snapshot === sourceSnapshot(root) && record.logHash === digest(readFileSync(join(root, record.log))) ? 0 : 1;
  } catch { return 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '..');
  process.exitCode = process.argv[2] === 'run' ? runHostQuality(root) : process.argv[2] === 'verify' ? verifyHostQuality(root) : 2;
}
