import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function setup(t, version) {
  const dir = mkdtempSync(join(tmpdir(), 'takt-installation-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin/takt'), `console.log(process.argv.includes('--version') ? ${JSON.stringify(version)} : 'selected-local-installation');`);
  return dir;
}
test('launcher uses selected installation for version and execution', t => {
  const dir = setup(t, '0.49.0');
  const result = spawnSync('bash', ['scripts/takt.sh', 'probe'], { encoding: 'utf8', env: { ...process.env, TAKT_PACKAGE_DIR: dir } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'selected-local-installation');
});
test('launcher rejects incompatible selected installation', t => {
  const dir = setup(t, '9.0.0');
  const result = spawnSync('bash', ['scripts/takt.sh', 'probe'], { encoding: 'utf8', env: { ...process.env, TAKT_PACKAGE_DIR: dir } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /0.49.0 is required/);
});
