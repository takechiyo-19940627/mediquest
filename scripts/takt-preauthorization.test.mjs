import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
test('project preauthorization contains only fixed development and read commands', () => {
  const config = read('.takt/config.yaml');
  const rules = [...config.matchAll(/^      - ("Bash\(.*\)")$/gm)].map(m => JSON.parse(m[1]));
  assert.equal(rules.length, 17);
  for (const rule of rules) {
    assert(!/[;*|&<>`\n]/.test(rule));
    assert.match(rule, /^Bash\((bash scripts\/app-command\.sh (ci|format|format:check|lint|typecheck|test:unit|test:integration|test:e2e|build|dev|browser:install|quality|versions)|git (status --short|diff( --check| --stat)?))\)$/);
  }
  assert.match(config, /provider: claude/);
  assert.match(config, /allow_unsandboxed_commands: false/);
  assert.match(read('.takt/workflows/mediquest-app.yaml'), /command: bash scripts\/app-command\.sh quality/);
});
test('project SDK settings require sandbox availability and do not auto-approve all sandboxed Bash', () => {
  const settings = JSON.parse(read('.claude/settings.json'));
  assert.equal(settings.sandbox.enabled, true);
  assert.equal(settings.sandbox.failIfUnavailable, true);
  assert.equal(settings.sandbox.autoAllowBashIfSandboxed, false);
  assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
  assert.deepEqual(settings.sandbox.excludedCommands, []);
  assert.equal(settings.permissions.disableBypassPermissionsMode, 'disable');
  assert(!settings.permissions.allow.some(rule => rule.startsWith('Edit(')), 'read-only review must not inherit an edit allow');
  for (const path of ['.claude', '.takt', '.git', '.github', 'scripts']) {
    assert(settings.permissions.deny.includes(`Edit(./${path}/**)`));
    assert(settings.sandbox.filesystem.denyWrite.includes(path));
  }
});

test('fixed app launcher pins runtime and per-worktree caches without forwarding extra arguments', async t => {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'app-command-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const stub = join(dir, 'nodenv');
  writeFileSync(stub, '#!/bin/sh\nif [ "$*" = "exec node --version" ]; then echo v24.15.0; exit; fi\nprintf "%s\\n" "$*" "$NODENV_VERSION" "$npm_config_cache" "$PLAYWRIGHT_BROWSERS_PATH"\n');
  chmodSync(stub, 0o755);
  const root = resolve(import.meta.dirname, '..');
  for (const operation of ['ci', 'test:integration', 'browser:install', 'quality']) {
    const result = spawnSync('bash', ['scripts/app-command.sh', operation], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, NODENV_VERSION: '20.19.0' } });
    assert.equal(result.status, 0, result.stderr);
    assert(result.stdout.includes('\n24.15.0\n'));
    assert(result.stdout.includes(`${root}/app/.cache/npm`));
    assert(result.stdout.includes(`${root}/app/.cache/ms-playwright`));
    if (operation === 'browser:install') assert(result.stdout.startsWith('exec node app/node_modules/playwright/cli.js install chromium\n'));
  }
  for (const args of [[], ['ci', '--ignore-scripts'], ['install'], ['ci; echo unexpected']]) {
    const result = spawnSync('bash', ['scripts/app-command.sh', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
  }
});

test('preflight blocks inherited approvals and malformed settings without exposing their values', async t => {
  const { inspectInheritedSettings } = await import('./takt-preflight.mjs');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'takt-preflight-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'settings.json');
  assert.deepEqual(inspectInheritedSettings([file]), []);
  for (const settings of [{ permissions: { allow: ['Bash(SECRET_VALUE)'] } }, { hooks: { PreToolUse: ['SECRET_VALUE'] } }, { sandbox: { enabled: false } }, { sandbox: { filesystem: { disabled: true } } }, { sandbox: { excludedCommands: ['SECRET_VALUE'] } }]) {
    writeFileSync(file, JSON.stringify(settings));
    const result = inspectInheritedSettings([file]);
    assert(result.length);
    assert(!JSON.stringify(result).includes('SECRET_VALUE'));
  }
  writeFileSync(file, '{');
  assert.equal(inspectInheritedSettings([file])[0].reason, 'unreadable settings');
  writeFileSync(file, JSON.stringify({ permissions: { deny: ['Bash(rm *)'] }, sandbox: { enabled: true } }));
  assert.deepEqual(inspectInheritedSettings([file]), []);
});
