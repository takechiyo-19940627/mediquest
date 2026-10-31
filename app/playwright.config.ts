import { defineConfig } from '@playwright/test';
import { e2eDatabasePath } from './scripts/e2e-database';

export default defineConfig({
  globalSetup: './tests/e2e/global-setup.ts',
  workers: 1,
  testDir: './tests/e2e',
  outputDir: './test-results/production',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://127.0.0.1:3100/api/health',
    env: {
      NITRO_HOST: '127.0.0.1',
      NITRO_PORT: '3100',
      MEDIQUEST_DB_PATH: e2eDatabasePath(),
      MEDIQUEST_LOCAL_MODE: 'true',
      MEDIQUEST_LOCAL_ORIGIN: 'http://127.0.0.1:3100',
    },
    reuseExistingServer: false,
    timeout: 180000,
  },
});
