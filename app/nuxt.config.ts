export default defineNuxtConfig({
  compatibilityDate: '2026-10-24',
  modules: ['@nuxt/ui', '@nuxt/eslint'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  ui: { fonts: false },
  typescript: { strict: true },
  colorMode: { preference: 'system', fallback: 'light' },
  app: { head: { htmlAttrs: { lang: 'ja' }, title: 'Mediquest' } },
});
