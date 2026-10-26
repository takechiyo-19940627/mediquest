import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

// The owner is globalSetup: suites only read the output and never remove it.
export async function createSharedBuild(
  parent: string,
  build: (buildDir: string, outputDir: string) => Promise<void>,
) {
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'shared-'));
  const outputDir = join(directory, 'output');
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    await build(join(directory, 'nuxt'), outputDir);
    return { outputDir, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
