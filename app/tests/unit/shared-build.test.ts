import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createSharedBuild } from '../fixtures/shared-build';

it('builds once per fresh run, preserves live artifacts and cleans success and failure', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'mediquest-build-test-'));
  try {
    let builds = 0;
    let source = 'first source';
    const build = async (buildDir: string) => {
      builds++;
      await writeFile(join(buildDir, '..', 'source'), source);
    };
    const first = await createSharedBuild(parent, build);
    source = 'changed source';
    const second = await createSharedBuild(parent, build);
    expect(builds).toBe(2);
    expect(first.outputDir).not.toBe(second.outputDir);
    expect(await readFile(join(first.outputDir, '..', 'source'), 'utf8')).toBe(
      'first source',
    );
    expect(await readFile(join(second.outputDir, '..', 'source'), 'utf8')).toBe(
      source,
    );
    const beforeFailure = await readdir(parent);
    await expect(
      createSharedBuild(parent, async () => {
        throw new Error('intentional build failure');
      }),
    ).rejects.toThrow('intentional build failure');
    expect(await readdir(parent)).toEqual(beforeFailure);
    await first.cleanup();
    await second.cleanup();
    expect(await readdir(parent)).toEqual([]);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
