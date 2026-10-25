import { createHash } from 'node:crypto';
import { openSync, readSync, closeSync, mkdirSync, copyFileSync, chmodSync, realpathSync, lstatSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
export const runtimeFiles = {
  codex: '8813367285524ac798dd96d1b071aea30d58708c7226fd236cd275cf1cfdee31',
  'codex-code-mode-host': '79f123a85dbc61e8f5d0f0c050dfc3f4b81a8305d33a32b41e008b7f6e035698',
};
export function fileHash(file) {
  const fd = openSync(file, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  try { let bytes; while ((bytes = readSync(fd, buffer)) > 0) hash.update(buffer.subarray(0, bytes)); return hash.digest('hex'); }
  finally { closeSync(fd); }
}
export function assertCodexRuntimeLocation(file, home = homedir()) {
  const actual = realpathSync(file);
  for (const secret of ['.codex', '.claude', '.aws', '.ssh']) {
    const location = resolve(home, secret);
    const denied = existsSync(location) ? realpathSync(location) : location;
    if (actual === denied || actual.startsWith(denied + '/')) throw new Error('Codex runtime resolves inside a denied credential directory');
  }
  return actual;
}
export function verifyRuntime(directory) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Only reviewed Codex 0.163.0 darwin-arm64 runtime is supported');
  for (const [name, expected] of Object.entries(runtimeFiles)) {
    const file = join(directory, name);
    if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink() || fileHash(file) !== expected) throw new Error('Unreviewed Codex runtime artifact');
    assertCodexRuntimeLocation(file);
  }
  return realpathSync(join(directory, 'codex'));
}
export function prepareRuntime(sourceExecutable, destination) {
  if (existsSync(destination)) throw new Error('Codex runtime destination must be new');
  const sourceDir = dirname(realpathSync(sourceExecutable));
  for (const [name, expected] of Object.entries(runtimeFiles)) if (fileHash(join(sourceDir, name)) !== expected) throw new Error('Unexpected Codex source artifact');
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const name of Object.keys(runtimeFiles)) { copyFileSync(join(sourceDir, name), join(destination, name)); chmodSync(join(destination, name), 0o500); }
  return verifyRuntime(destination);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'prepare' && process.argv.length === 5) console.log(prepareRuntime(process.argv[3], process.argv[4]));
    else if (process.argv[2] === 'verify' && process.argv.length === 4) console.log(verifyRuntime(process.argv[3]));
    else throw new Error('Usage: codex-runtime.mjs prepare source-executable new-directory | verify directory');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
