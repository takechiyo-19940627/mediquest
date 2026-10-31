import { dirname, join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { e2eDatabasePath } from './scripts/e2e-database';

export default defineConfig({
  globalSetup: './tests/e2e/global-setup.ts',
  workers: 1,
  testDir: './tests/admin-e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:3102', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command:
      'node tests/fixtures/build-admin-e2e.mjs && node .nuxt/admin-e2e-output/server/index.mjs',
    url: 'http://127.0.0.1:3102/api/health',
    env: {
      NITRO_HOST: '127.0.0.1',
      NITRO_PORT: '3102',
      MEDIQUEST_DB_PATH: e2eDatabasePath(),
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: 'http://127.0.0.1:3102',
      MEDIQUEST_GENERATION_ENABLED: 'true',
      ANTHROPIC_API_KEY: 'TEST_ONLY_KEY',
      MEDIQUEST_ANTHROPIC_MODEL: 'test-model',
      TEST_GENERATION_EVENTS: join(
        dirname(e2eDatabasePath()),
        'generation-events',
      ),
    },
    reuseExistingServer: false,
    timeout: 180000,
  },
});
