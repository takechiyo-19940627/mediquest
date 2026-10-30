import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export const sdkTarget = 'node_modules/@openai/codex-sdk/dist/index.js';
export const sdkOriginalHash = '3e5f6e013cf5d0bf9a93072a6c45d23d9eac05b282ceb9bca97ca157bb04ab92';
const sha = value => createHash('sha256').update(value).digest('hex');
export function patchedSdkSource(source) {
  if (sha(source) !== sdkOriginalHash) throw new Error('Unreviewed Codex SDK source hash');
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error('Codex SDK patch context mismatch');
    source = source.replace(before, after);
  };
  // Retain the listener until stream disposal: a failed write can emit after process exit.
  replace('    child.stdin.write(args.input);', '    let stdinError = null;\n    child.stdin.on("error", (err) => stdinError ??= err);\n    child.stdin.write(args.input);');
  // close follows stdio closure, so stderr and any stdin failure are available.
  replace('child.once("exit", (code, signal) => {', 'child.once("close", (code, signal) => {');
  replace('    } finally {\n      rl.close();', '      if (stdinError) throw stdinError;\n    } finally {\n      rl.close();');
  return source;
}
export function readOriginalSdk(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'node_modules/@openai/codex-sdk/package.json')));
  if (pkg.name !== '@openai/codex-sdk' || pkg.version !== '0.137.0') throw new Error('Codex SDK 0.137.0 required');
  return readFileSync(join(dir, sdkTarget), 'utf8');
}
export function applySdkPatch(dir) {
  const original = readOriginalSdk(dir);
  const patched = patchedSdkSource(original);
  writeFileSync(join(dir, '.mediquest-original-codex-sdk.js'), original);
  writeFileSync(join(dir, sdkTarget), patched);
}
export function verifySdkPatch(dir) {
  const current = readOriginalSdk(dir);
  const expected = patchedSdkSource(readFileSync(join(dir, '.mediquest-original-codex-sdk.js'), 'utf8'));
  if (current !== expected) throw new Error('Unreviewed Codex SDK stdin patch');
}
