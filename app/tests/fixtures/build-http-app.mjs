import { buildNuxt, loadNuxt } from '@nuxt/kit';

// Run Nuxt in Node rather than Vitest's module runner, just like the Nuxt CLI.
const [root, buildDir, outputDir] = process.argv.slice(2);
const nuxt = await loadNuxt({
  cwd: root,
  dev: false,
  overrides: { buildDir, nitro: { output: { dir: outputDir } } },
});
try {
  await buildNuxt(nuxt);
} finally {
  await nuxt.close();
}
