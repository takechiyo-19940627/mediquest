#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Reviewed host policy, not promoted from worker-editable project settings.
export const trustedSandbox = {
  enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: false,
  allowUnsandboxedCommands: false, excludedCommands: [],
  filesystem: { disabled: false },
  network: {
    allowLocalBinding: true,
    allowedDomains: ['registry.npmjs.org', 'github.com', 'objects.githubusercontent.com',
      'release-assets.githubusercontent.com', 'cdn.playwright.dev',
      'playwright.download.prss.microsoft.com', '127.0.0.1', 'localhost'],
  },
};
export function trustedArguments(args) {
  const indices = args.flatMap((arg, index) => arg === '--settings' ? [index] : []);
  if (indices.length !== 1 || args.some(arg => arg.startsWith('--settings=') || arg.startsWith('--setting-sources') || arg.startsWith('--dangerously-'))) throw new Error('Unexpected Claude settings arguments');
  const index = indices[0];
  const input = JSON.parse(args[index + 1]);
  if (Object.keys(input).join() !== 'sandbox' || Object.keys(input.sandbox).sort().join() !== 'allowUnsandboxedCommands,excludedCommands' || input.sandbox.allowUnsandboxedCommands !== false || !Array.isArray(input.sandbox.excludedCommands) || input.sandbox.excludedCommands.length) throw new Error('Unexpected TAKT sandbox policy');
  return args.map((arg, i) => i === index + 1 ? JSON.stringify({ sandbox: trustedSandbox }) : arg);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const executable = process.env.MEDIQUEST_CLAUDE_EXECUTABLE;
    if (!executable || !executable.startsWith('/') || resolve(executable) === resolve(process.argv[1])) throw new Error('Missing Claude executable');
    const child = spawn(executable, trustedArguments(process.argv.slice(2)), { stdio: 'inherit' });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
    child.on('error', () => { console.error('Claude launch failed'); process.exitCode = 1; });
    child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
  } catch { console.error('Trusted Claude launch rejected unexpected configuration'); process.exitCode = 1; }
}
