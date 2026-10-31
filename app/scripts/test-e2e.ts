import { spawn } from 'node:child_process';
import { withE2eDatabase } from './e2e-database.ts';

const exitCode = await withE2eDatabase(async (env) => {
  const child = spawn(
    process.execPath,
    ['node_modules/playwright/cli.js', 'test'],
    { env, stdio: 'inherit' },
  );
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    return await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
});
process.exitCode = exitCode;
