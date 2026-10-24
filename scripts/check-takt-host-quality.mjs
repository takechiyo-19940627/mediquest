import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const pkg = resolve(process.argv[2]);
assert.equal(JSON.parse(readFileSync(join(pkg, 'package.json'))).version, '0.49.0');
const { runCommandQualityGate } = await import(pathToFileURL(join(pkg, 'dist/core/workflow/quality-gates/commandGateRunner.js')));
const { loadWorkflowFromFile } = await import(pathToFileURL(join(pkg, 'dist/infra/config/loaders/workflowFileLoader.js')));
const root = resolve(import.meta.dirname, '..');
const workflow = loadWorkflowFromFile(join(root, '.takt/workflows/mediquest-app.yaml'), root);
for (const name of ['implement', 'fix']) {
  const step = workflow.steps.find(step => step.name === name);
  assert.equal(step.qualityGates[0].command, 'bash scripts/app-command.sh host-quality');
  assert.equal(step.qualityGates[0].timeoutMs, 2400000);
}
assert.equal(workflow.steps.find(step => step.name === 'review').edit, false);
assert.equal(workflow.steps.find(step => step.name === 'finalize').qualityGates[0].command, 'bash scripts/app-command.sh host-quality-verify');
const fixture = mkdtempSync(join(tmpdir(), 'real-takt-gate-'));
const oldPath = process.env.PATH;
try {
  mkdirSync(join(fixture, 'scripts'));
  copyFileSync(join(root, 'scripts/app-command.sh'), join(fixture, 'scripts/app-command.sh'));
  const stub = join(fixture, 'nodenv');
  writeFileSync(stub, '#!/bin/bash\n[[ -z "${HOME+x}" ]] || exit 41\n[[ "$NODENV_ROOT" = ~' + '/.nodenv ]] || exit 42\n[[ "$NODENV_VERSION" = 24.15.0 ]] || exit 43\nif [[ "$*" = "exec node --version" ]]; then echo v24.15.0; else echo fixture-npm; fi\n');
  chmodSync(stub, 0o755);
  process.env.PATH = `${fixture}:${oldPath}`;
  const gate = { type: 'command', command: 'bash scripts/app-command.sh versions', cwd: '.', timeoutMs: 10000 };
  const result = await runCommandQualityGate({ gate, projectRoot: fixture });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.stdout, /fixture-npm/);
  const failure = await runCommandQualityGate({ gate: { ...gate, command: 'exit 7' }, projectRoot: fixture });
  assert.equal(failure.ok, false);
  assert.equal(failure.failure.exitCode, 7);
  mkdirSync(join(fixture, '.takt/quality'), { recursive: true });
  writeFileSync(join(fixture, '.takt/quality/latest.json'), JSON.stringify({ status: 'passed' }));
  writeFileSync(stub, '#!/bin/bash\nexit 43\n');
  const runtimeFailure = await runCommandQualityGate({ gate: { ...gate, command: 'bash scripts/app-command.sh host-quality' }, projectRoot: fixture });
  assert.equal(runtimeFailure.ok, false);
  assert.equal(JSON.parse(readFileSync(join(fixture, '.takt/quality/latest.json'))).status, 'initializing');
  console.log('Real TAKT 0.49 commandGateRunner scrubbed-env launcher and failure regression passed; no app/LLM/queue execution.');
} finally { process.env.PATH = oldPath; rmSync(fixture, { recursive: true, force: true }); }
