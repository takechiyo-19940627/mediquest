import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const pkg = resolve(process.argv[2]);
assert.equal(JSON.parse(readFileSync(join(pkg, 'package.json'))).version, '0.49.0');
const load = file => import(pathToFileURL(join(pkg, file)));
const { loadWorkflowFromFile } = await load('dist/infra/config/loaders/workflowFileLoader.js');
const { loadProjectConfig } = await load('dist/infra/config/project/projectConfig.js');
const { callCodex } = await load('dist/infra/codex/client.js');
const root = resolve(import.meta.dirname, '..');
const config = loadProjectConfig(root);
assert.equal(config.provider, 'claude');
const workflow = loadWorkflowFromFile(join(root, '.takt/workflows/mediquest-app.yaml'), root);
for (const step of workflow.steps) {
  if (['implement', 'fix'].includes(step.name)) {
    assert.equal(step.provider, 'codex');
    assert.equal(step.providerOptions.codex.networkAccess, false);
    assert.equal(step.requiredPermissionMode, 'edit');
    assert.equal(step.qualityGates[0].command, 'bash scripts/app-command.sh host-quality');
  } else { assert.equal(step.edit, false); assert.equal(step.provider, undefined); }
}
const dir = mkdtempSync(join(tmpdir(), 'takt-codex-'));
try {
  const capture = join(dir, 'args.json'), cli = join(dir, 'fake-codex');
  writeFileSync(cli, `#!${process.execPath}\nif (process.argv.includes('--version')) {console.log('codex-cli 0.163.0'); process.exit(0);}\nrequire('node:fs').writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2)));\nprocess.stdin.resume();\nprocess.stdin.on('end', () => {for (const event of [{type:'thread.started',thread_id:'fixture'},{type:'item.completed',item:{id:'1',type:'agent_message',text:'fixture'}},{type:'turn.completed',usage:{input_tokens:1,output_tokens:1,cached_input_tokens:0}}])console.log(JSON.stringify(event));});\n`);
  chmodSync(cli, 0o755);
  process.env.MEDIQUEST_CODEX_EXECUTABLE = cli;
  process.env.TAKT_CODEX_CLI_PATH = join(root, 'scripts/codex-scoped.mjs');
  const { resolveCodexCliPath } = await load('dist/infra/config/global/globalConfigResolvers.js');
  for (const permissionMode of ['edit', 'readonly']) {
    const result = await callCodex('fixture', 'No model is called', { cwd: root, permissionMode, networkAccess: false, codexPathOverride: resolveCodexCliPath() });
    assert.equal(result.status, 'done', JSON.stringify(result));
    const args = JSON.parse(readFileSync(capture));
    assert(args.includes('--json'));
    assert(!args.includes('--sandbox'));
    assert(args.includes('approval_policy="never"'));
    assert(args.includes('default_permissions="mediquest-takt"'));
    assert(args.some(arg => arg.includes(`"extends" = "${permissionMode === 'edit' ? ':workspace' : ':read-only'}"`)));
  }
  console.log('TAKT project/workflow provider split and actual Codex SDK→scoped wrapper→inert CLI passed. No model, network or task execution.');
} finally { rmSync(dir, { recursive: true, force: true }); }
