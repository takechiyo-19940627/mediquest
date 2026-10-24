import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runHostQuality, verifyHostQuality } from './host-quality.mjs';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'host-quality-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  writeFileSync(join(root, '.gitignore'), '.takt/\n');
  writeFileSync(join(root, 'source.ts'), 'original');
  return root;
}
const pass = (_command, _args, options) => { writeFileSync(options.stdio[1], 'all seven fixture checks\n'); return { status: 0 }; };
test('host evidence is worktree/source bound; untracked edits and log tampering invalidate', t => {
  const root = fixture(t);
  assert.equal(verifyHostQuality(root), 1);
  assert.equal(runHostQuality(root, pass), 0);
  assert.equal(verifyHostQuality(root), 0);
  writeFileSync(join(root, 'source.ts'), 'changed');
  assert.equal(verifyHostQuality(root), 1);
  writeFileSync(join(root, 'source.ts'), 'original');
  assert.equal(verifyHostQuality(root), 0);
  const record = JSON.parse(readFileSync(join(root, '.takt/quality/latest.json')));
  writeFileSync(join(root, record.log), 'tampered');
  assert.equal(verifyHostQuality(root), 1);
  assert.equal(runHostQuality(root, pass), 0);
  writeFileSync(join(root, 'new.ts'), 'new untracked implementation');
  assert.equal(verifyHostQuality(root), 1);
});
test('failed, crashed or source-changing attempts replace earlier success with failure', t => {
  const root = fixture(t);
  for (const run of [() => ({ status: 2 }), () => { throw new Error('fixture'); }, (...args) => { writeFileSync(join(root, 'source.ts'), String(Math.random())); return pass(...args); }]) {
    assert.equal(runHostQuality(root, pass), 0);
    const previous = JSON.parse(readFileSync(join(root, '.takt/quality/latest.json'))).attemptId;
    assert.equal(runHostQuality(root, run), 1);
    const record = JSON.parse(readFileSync(join(root, '.takt/quality/latest.json')));
    assert.notEqual(record.attemptId, previous);
    assert.equal(record.status, 'failed');
    assert.equal(verifyHostQuality(root), 1);
  }
});
test('copied evidence and interrupted running attempts never verify', t => {
  const root = fixture(t), other = fixture(t);
  assert.equal(runHostQuality(root, pass), 0);
  mkdirSync(join(other, '.takt/quality'), { recursive: true });
  const path = join(root, '.takt/quality/latest.json');
  const record = JSON.parse(readFileSync(path));
  writeFileSync(join(other, '.takt/quality/latest.json'), JSON.stringify(record));
  assert.equal(verifyHostQuality(other), 1);
  record.status = 'running'; writeFileSync(path, JSON.stringify(record));
  assert.equal(verifyHostQuality(root), 1);
});
