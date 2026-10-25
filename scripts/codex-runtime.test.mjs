import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertCodexRuntimeLocation, verifyRuntime, prepareRuntime } from './codex-runtime.mjs';
test('runtime realpath rejects symlink into denied credential tree without permitting that tree', t => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-runtime-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home'); mkdirSync(join(home, '.codex'), { recursive: true });
  const secretBinary = join(home, '.codex/codex'); writeFileSync(secretBinary, 'fixture');
  const link = join(dir, 'codex'); symlinkSync(secretBinary, link);
  assert.throws(() => assertCodexRuntimeLocation(link, home), /denied credential/);
  const runtime = join(dir, 'runtime'); mkdirSync(runtime); writeFileSync(join(runtime, 'codex'), 'fixture');
  assert.equal(assertCodexRuntimeLocation(join(runtime, 'codex'), home), realpathSync(join(runtime, 'codex')));
  assert.throws(() => verifyRuntime(runtime));
  assert.throws(() => prepareRuntime(join(runtime, 'codex'), join(dir, 'new-runtime')), /source artifact/);
  assert.throws(() => prepareRuntime(join(runtime, 'codex'), runtime), /must be new/);
});
test('credential deny stays intact and launcher has no PATH runtime fallback', () => {
  const wrapper = readFileSync(new URL('./codex-scoped.mjs', import.meta.url), 'utf8');
  assert(wrapper.includes("'~/.codex': 'deny'"));
  assert(wrapper.includes('assertCodexRuntimeLocation(executable)'));
  const launcher = readFileSync(new URL('./takt.sh', import.meta.url), 'utf8');
  assert(launcher.includes('scripts/codex-runtime.mjs verify'));
  assert(!launcher.includes('MEDIQUEST_CODEX_EXECUTABLE="$(command -v codex)"'));
  assert(!launcher.includes('export MEDIQUEST_CODEX_EXECUTABLE="$')); // export must not mask verifier failure
});
