import { defineConfig } from '@playwright/test';

const isLocal = process.env.E2E_ENV === 'local';
const apiPort = process.env.E2E_API_PORT ?? '8788';
const webPort = process.env.E2E_WEB_PORT ?? '4173';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: isLocal
      ? `http://127.0.0.1:${webPort}`
      : process.env.STAGING_BASE_URL,
    trace: 'retain-on-failure',
  },
  webServer: isLocal
    ? [
        {
          command: 'pnpm --filter @cocolo/api dev',
          url: `http://127.0.0.1:${apiPort}/health`,
          env: { ...process.env, PORT: apiPort },
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command: 'pnpm --filter @cocolo/web dev --host 127.0.0.1',
          url: `http://127.0.0.1:${webPort}/health`,
          env: {
            ...process.env,
            VITE_PORT: webPort,
            VITE_API_PROXY_URL: `http://127.0.0.1:${apiPort}`,
          },
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ]
    : undefined,
  projects: [{ name: 'local' }, { name: 'staging' }],
});
