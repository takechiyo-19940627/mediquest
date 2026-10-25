#!/usr/bin/env node
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';
import { assertCodexRuntimeLocation } from './codex-runtime.mjs';
import { pathToFileURL } from 'node:url';
export function scopedCodexArguments(args) {
  if (args[0] !== 'exec') throw new Error('Only TAKT Codex exec is supported');
  const output = ['exec', '--ignore-user-config', '--ignore-rules'];
  let mode, cwd;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--sandbox') {
      if (mode) throw new Error('Duplicate sandbox mode');
      mode = args[++i];
      if (!['workspace-write', 'read-only'].includes(mode)) throw new Error('Unsupported sandbox mode');
    } else if (arg === '--cd') {
      if (cwd || !isAbsolute(args[i + 1] ?? '')) throw new Error('Invalid working directory');
      cwd = args[++i]; output.push(arg, cwd);
    } else if (arg === '--config' || arg === '-c') {
      const value = args[++i];
      if (value === 'sandbox_workspace_write.network_access=false') continue;
      if (!/^model_reasoning_effort="(minimal|low|medium|high|xhigh)"$/.test(value ?? '')) throw new Error('Unexpected SDK configuration');
      output.push(arg, value);
    } else if (arg === '--experimental-json') output.push('--json');
    else if (['--json', '--skip-git-repo-check'].includes(arg)) output.push(arg);
    else if (['--model', '--output-schema', '--image'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('Missing SDK argument');
      output.push(arg, value);
    } else if (arg === 'resume') {
      const id = args[++i];
      if (!/^[a-zA-Z0-9-]+$/.test(id ?? '')) throw new Error('Invalid resume identifier');
      output.push(arg, id);
    } else throw new Error('Unexpected SDK argument');
  }
  if (!cwd || !mode) throw new Error('Missing SDK sandbox/cwd');
  const readonly = mode === 'read-only';
  const profile = { extends: readonly ? ':read-only' : ':workspace', filesystem: {
    '~/.ssh': 'deny', '~/.aws': 'deny', '~/.claude': 'deny', '~/.codex': 'deny',
    ':workspace_roots': Object.fromEntries([
      ...['.claude', '.takt', '.github', 'scripts', 'AGENTS.md', 'app/AGENTS.md', 'docs', 'agents', 'learning-rust'].map(path => [path, 'read']),
      ...['.env', '.env.*', 'app/.env', 'app/.env.*'].map(path => [path, 'deny']),
    ]),
  }, network: { enabled: false } };
  // TOML inline tables, with all path keys quoted, are accepted by the official CLI -c interface.
  const toml = value => typeof value === 'object' ? `{ ${Object.entries(value).map(([key, child]) => `${JSON.stringify(key)} = ${toml(child)}`).join(', ')} }` : JSON.stringify(value);
  output.splice(1, 0, '--config', 'approval_policy="never"', '--config', 'web_search="disabled"', '--config', 'default_permissions="mediquest-takt"', '--config', `permissions.mediquest-takt=${toml(profile)}`);
  return { args: output, cwd, profile };
}
export function assertWorktreeRoot(cwd) {
  const root = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (realpathSync(cwd) !== realpathSync(root)) throw new Error('Codex must start at the Git worktree root');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { args, cwd } = scopedCodexArguments(process.argv.slice(2));
    assertWorktreeRoot(cwd);
    // Legacy sandbox config can take precedence over named profiles. Do not silently inherit it.
    if ([join(cwd, '.codex/config.toml'), '/etc/codex/config.toml'].some(existsSync)) throw new Error('Additional config requires review');
    const executable = process.env.MEDIQUEST_CODEX_EXECUTABLE;
    if (!executable || !isAbsolute(executable) || resolve(executable) === resolve(process.argv[1])) throw new Error('Missing Codex executable');
    const runtimeExecutable = assertCodexRuntimeLocation(executable);
    const version = spawnSync(runtimeExecutable, ['--version'], { encoding: 'utf8', timeout: 10000 });
    if (version.status !== 0 || version.stdout.trim() !== 'codex-cli 0.163.0') throw new Error('Unreviewed Codex CLI version');
    const child = spawn(runtimeExecutable, args, { stdio: 'inherit' });
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
    child.on('error', () => { console.error('Scoped Codex launch failed'); process.exitCode = 1; });
    child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
  } catch { console.error('Scoped Codex launch rejected unexpected configuration'); process.exitCode = 1; }
}
