import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const installation = process.argv[2];
if (!installation) throw new Error('Pass the reviewed TAKT 0.49.0 package directory; only a local fake CLI is spawned.');
const pkg = resolve(installation);
assert.equal(JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version, '0.49.0');
const root = resolve(import.meta.dirname, '..');
const load = name => import(pathToFileURL(join(pkg, name)).href);
const { loadProjectConfig } = await load('dist/infra/config/project/projectConfig.js');
const { loadWorkflowFromFile } = await load('dist/infra/config/loaders/workflowFileLoader.js');
const { resolveAllowedToolsForProvider } = await load('dist/core/workflow/engine/engine-provider-options.js');
const { callClaudeHeadless } = await load('dist/infra/claude-headless/client.js');
const project = loadProjectConfig(root);
assert.equal(project.provider, 'claude');
const options = project.providerOptions.claude;
assert(options.allowedTools.includes('Bash(bash scripts/app-command.sh ci)'));
assert.deepEqual(options.sandbox, { allowUnsandboxedCommands: false, excludedCommands: [] });
assert(loadWorkflowFromFile(join(root, '.takt/workflows/mediquest-app.yaml'), root));
const dir = mkdtempSync(join(tmpdir(), 'takt-headless-args-'));
try {
  const cli = join(dir, 'fake-claude');
  const capture = join(dir, 'args.json');
  writeFileSync(cli, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2)));\nconsole.log(JSON.stringify({type:'result',subtype:'success',result:'fixture',is_error:false,session_id:'fixture'}));\n`);
  chmodSync(cli, 0o755);
  for (const edit of [true, false]) {
    const allowedTools = resolveAllowedToolsForProvider(project.providerOptions, true, edit, 'claude');
    if (edit) assert.deepEqual(allowedTools, options.allowedTools);
    else assert.deepEqual(allowedTools, [], 'read-only steps must filter all Bash permissions');
    await callClaudeHeadless('fixture', 'argument capture only', { cwd: root, claudeCliPath: cli, permissionMode: edit ? 'edit' : 'readonly', allowedTools, sandbox: options.sandbox });
    const args = JSON.parse(readFileSync(capture, 'utf8'));
    assert.equal(args[args.indexOf('--permission-mode') + 1], edit ? 'acceptEdits' : 'default');
    if (edit) assert.equal(args[args.indexOf('--allowed-tools') + 1], allowedTools.join(','));
    else assert(!args.includes('--allowed-tools'));
    assert.deepEqual(JSON.parse(args[args.indexOf('--settings') + 1]), { sandbox: options.sandbox });
    assert(!args.includes('--dangerously-skip-permissions'));
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log('TAKT 0.49.0 project/workflow loaders, engine edit filtering and headless CLI arguments passed using an inert fake CLI. Real Claude/sandbox behavior is untested.');
