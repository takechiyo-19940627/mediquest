import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { inject } from 'vitest';
import { setup } from '@nuxt/test-utils/e2e';

declare module 'vitest' {
  interface ProvidedContext {
    mediquestNuxtOutputDir: string;
  }
}

export function setupSharedHttpServer(
  options: Pick<
    NonNullable<Parameters<typeof setup>[0]>,
    'rootDir' | 'port' | 'env'
  >,
) {
  const outputDir = inject('mediquestNuxtOutputDir');
  if (!outputDir || !existsSync(join(outputDir, 'server/index.mjs')))
    throw new Error('Fresh shared Nuxt output is required');
  return setup({
    ...options,
    server: true,
    build: false,
    nuxtConfig: { nitro: { output: { dir: outputDir } } },
  });
}
