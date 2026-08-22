import { defineConfig } from '@playwright/test';

const isLocal = process.env.E2E_ENV === 'local';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: isLocal ? 'http://127.0.0.1:4173' : process.env.STAGING_BASE_URL,
    trace: 'retain-on-failure',
  },
  webServer: isLocal
    ? [
        {
          command: 'pnpm --filter @cocolo/api dev:test',
          url: 'http://127.0.0.1:8787/health',
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command: 'pnpm --filter @cocolo/web dev --host 127.0.0.1 --port 4173',
          url: 'http://127.0.0.1:4173/health',
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ]
    : undefined,
  projects: [{ name: 'local' }, { name: 'staging' }],
});
