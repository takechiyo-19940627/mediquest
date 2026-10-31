import { fileURLToPath } from 'node:url';
import { buildNuxt, loadNuxt } from '@nuxt/kit';

// Fixed provider is selected only by this test entrypoint, in a separate artifact.
const nuxt = await loadNuxt({
  cwd: fileURLToPath(new URL('../..', import.meta.url)),
  dev: false,
  overrides: {
    buildDir: '.nuxt/admin-e2e',
    nitro: { output: { dir: '.nuxt/admin-e2e-output' } },
    alias: {
      '#generation-provider': fileURLToPath(
        new URL('./generation-api-provider.ts', import.meta.url),
      ),
    },
  },
});
try {
  await buildNuxt(nuxt);
} finally {
  await nuxt.close();
}
