import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trustedArguments, trustedSandbox } from './claude-trusted.mjs';
const original = ['-p', '--permission-mode', 'acceptEdits', '--allowed-tools', 'Bash(bash scripts/app-command.sh ci)', '--settings', JSON.stringify({ sandbox: { allowUnsandboxedCommands: false, excludedCommands: [] } })];
test('trusted CLI scope carries approved network policy without relaxing isolation or tools', () => {
  const result = trustedArguments(original);
  assert.deepEqual(result.slice(0, -1), original.slice(0, -1));
  const sandbox = JSON.parse(result.at(-1)).sandbox;
  const project = JSON.parse(readFileSync(new URL('../.claude/settings.json', import.meta.url))).sandbox;
  assert.deepEqual(sandbox.network, project.network);
  assert.equal(sandbox.network.allowLocalBinding, true);
  assert(sandbox.network.allowedDomains.includes('registry.npmjs.org'));
  assert.equal(sandbox.filesystem.disabled, false);
  for (const key of ['enabled', 'failIfUnavailable', 'autoAllowBashIfSandboxed', 'allowUnsandboxedCommands', 'excludedCommands']) assert.deepEqual(sandbox[key], project[key]);
  assert.deepEqual(sandbox, trustedSandbox);
});
test('unexpected settings, duplicate sources and unsandboxed overrides fail closed', () => {
  for (const args of [[], [...original, '--settings', '{}'], [...original, '--setting-sources', 'user'], [...original, '--settings={}'], [...original, '--dangerously-skip-permissions'], [...original.slice(0, -1), '{'], [...original.slice(0, -1), JSON.stringify({ sandbox: { allowUnsandboxedCommands: true, excludedCommands: [] } })], [...original.slice(0, -1), JSON.stringify({ sandbox: { allowUnsandboxedCommands: false, excludedCommands: ['npm'] } })], [...original.slice(0, -1), JSON.stringify({ sandbox: { allowUnsandboxedCommands: false, excludedCommands: [], network: { allowedDomains: ['*'] } } })]]) assert.throws(() => trustedArguments(args));
});
