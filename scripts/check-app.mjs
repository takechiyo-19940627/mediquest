import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A shared, fail-closed entry point for TAKT and future CI.
export const requiredScripts = [
  'format:check', 'lint', 'typecheck', 'test:unit',
  'test:integration', 'test:e2e', 'build',
];

export function checkApp(root, run = spawnSync) {
  const cwd = resolve(root, 'app');
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
  } catch {
    console.error('App package.json is missing or invalid. Bootstrap the application first.');
    return 1;
  }
  const missing = requiredScripts.filter(name =>
    typeof pkg.scripts?.[name] !== 'string' || !pkg.scripts[name].trim());
  if (missing.length) {
    console.error(`Missing required quality scripts: ${missing.join(', ')}`);
    return 1;
  }
  // npm runs package scripts even if installation later uses another manager.
  for (const name of requiredScripts) {
    console.log(`Checking ${name}`);
    const result = run('npm', ['run', name], {
      cwd, stdio: 'inherit', shell: false,
      timeout: 300_000,
      env: { ...process.env, CI: 'true' },
    });
    if (result.error || result.status !== 0) {
      console.error(`Quality check failed: ${name}`);
      return 1;
    }
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  process.exitCode = checkApp(root);
}
