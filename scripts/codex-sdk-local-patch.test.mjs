import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { patchedSdkSource } from './codex-sdk-local-patch.mjs';
// Supply the pinned installed SDK source explicitly; never silently skip regressions.
if (!process.env.CODEX_SDK_SOURCE) throw new Error('CODEX_SDK_SOURCE must point to unmodified Codex SDK 0.137.0 dist/index.js');
const original = readFileSync(process.env.CODEX_SDK_SOURCE, 'utf8');
const patched = patchedSdkSource(original);
function run(t, source, childBody, size = 8 * 1024 * 1024) {
  const dir = mkdtempSync(join(tmpdir(), 'sdk-stdin-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'sdk.mjs'), source);
  const child = join(dir, 'child');
  writeFileSync(child, `#!${process.execPath}\n${childBody}\n`, { mode: 0o755 });
  writeFileSync(join(dir, 'runner.mjs'), `import { Codex } from './sdk.mjs';
    const codex = new Codex({ codexPathOverride: ${JSON.stringify(child)} });
    try { const lines = []; for await (const line of codex.exec.run({ input: 'x'.repeat(${size}) })) lines.push(line);
      console.log(JSON.stringify({ ok: true, lines }));
    } catch (error) { console.log(JSON.stringify({ ok: false, message: error.message, code: error.code })); process.exitCode = 17; }
  `);
  const result = spawnSync(process.execPath, [join(dir, 'runner.mjs')], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined);
  return result;
}
const reject = `process.stderr.write('scoped guard rejected extra config\\n', () => process.exit(23));`;
test('unmodified pinned SDK reproduces unhandled EPIPE for early exit and large input', t => {
  const result = run(t, original, reject);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unhandled 'error' event/);
  assert.match(result.stderr, /EPIPE/);
});
test('early exit is caught and preserves actual exit code and stderr', t => {
  const result = run(t, patched, reject);
  assert.equal(result.status, 17);
  assert.equal(result.stderr, '');
  const value = JSON.parse(result.stdout);
  assert.equal(value.ok, false);
  assert.match(value.message, /code 23: scoped guard rejected extra config/);
});
test('normal success reads complete input and yields output unchanged', t => {
  const result = run(t, patched, `let size = 0; process.stdin.on('data', chunk => size += chunk.length); process.stdin.on('end', () => console.log('read:' + size));`);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, lines: ['read:8388608'] });
  assert.equal(result.stderr, '');
});
test('failure after consuming input remains failure and drains large stderr', t => {
  const result = run(t, patched, `process.stdin.resume(); process.stdin.on('end', () => { process.stderr.write('z'.repeat(128 * 1024) + 'FINAL_DIAGNOSTIC', () => process.exit(29)); });`, 100);
  assert.equal(result.status, 17);
  assert.match(JSON.parse(result.stdout).message, /code 29: z+FINAL_DIAGNOSTIC$/);
});
test('zero child exit cannot hide incomplete prompt transport', t => {
  const result = run(t, patched, 'process.exit(0);');
  assert.equal(result.status, 17);
  assert.equal(JSON.parse(result.stdout).code, 'EPIPE');
});
test('unknown source is rejected', () => assert.throws(() => patchedSdkSource(original + '\n'), /hash/));
