import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/preview',
  outputDir: './test-results/preview',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:3101', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop-preview',
      use: { viewport: { width: 1280, height: 800 } },
    },
    { name: 'mobile-preview', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'npm run dev -- --port 3101',
    url: 'http://127.0.0.1:3101/dev/study-preview',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
