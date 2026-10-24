import { fileURLToPath } from 'node:url';

export default defineNuxtConfig({
  alias: {
    '#generation-provider': fileURLToPath(
      new URL('./server/services/generation/provider.ts', import.meta.url),
    ),
  },
  compatibilityDate: '2026-10-24',
  modules: [
    '@nuxt/ui',
    '@nuxt/eslint',
    function (_options, nuxt) {
      if (!nuxt.options.dev) return;
      nuxt.hook('pages:extend', (pages) => {
        pages.push({
          name: 'development-study-preview',
          path: '/dev/study-preview',
          file: fileURLToPath(
            new URL('./app/dev-preview/StudyPreview.vue', import.meta.url),
          ),
        });
      });
    },
  ],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  ui: { fonts: false },
  typescript: { strict: true },
  colorMode: { preference: 'system', fallback: 'light' },
  app: { head: { htmlAttrs: { lang: 'ja' }, title: 'Mediquest' } },
});
