import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Local runs read the admin login and DB settings from .env; CI passes real env vars
if (existsSync('.env')) process.loadEnvFile('.env');

/**
 * Browser tests of the whole stack (web + API + in-process worker) with the keyless fake model.
 * Needs Postgres and Redis running and migrated (docker compose up -d && pnpm migrate).
 * Locally, already running dev servers are reused.
 */
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @docs-assistant/api start',
      url: 'http://localhost:3001/health',
      reuseExistingServer: !process.env.CI,
      env: { RUN_WORKER_IN_API: 'true', LLM_PROVIDER: 'fake', FAKE_LLM_DELAY_MS: '40' },
    },
    {
      command: 'pnpm --filter @docs-assistant/web start',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
