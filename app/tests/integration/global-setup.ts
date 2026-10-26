import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { TestProject } from 'vitest/node';
import { createSharedBuild } from '../fixtures/shared-build';

export default async function setup(project: TestProject) {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const started = performance.now();
  const artifact = await createSharedBuild(
    join(root, '.nuxt/test'),
    (buildDir, outputDir) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            fileURLToPath(
              new URL('../fixtures/build-http-app.mjs', import.meta.url),
            ),
            root,
            buildDir,
            outputDir,
          ],
          { stdio: 'inherit' },
        );
        child.once('error', reject);
        child.once('exit', (code, signal) => {
          if (code === 0) resolve();
          else
            reject(
              new Error(
                `Shared Nuxt build failed: code=${code} signal=${signal}`,
              ),
            );
        });
      }),
  );
  try {
    project.provide('mediquestNuxtOutputDir', artifact.outputDir);
    console.info(
      `[integration] shared Nuxt build count=1 elapsedMs=${Math.round(performance.now() - started)} output=${artifact.outputDir}`,
    );
  } catch (error) {
    await artifact.cleanup();
    throw error;
  }
  return artifact.cleanup;
}
