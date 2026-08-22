import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const environment = process.argv[2];
assert.ok(environment === 'local' || environment === 'staging');
assert.notEqual(
  process.env.APP_ENV,
  'production',
  'productionからE2Eを起動できません',
);
if (environment === 'staging')
  assert.ok(
    process.env.STAGING_BASE_URL,
    'staging E2EにはSTAGING_BASE_URLが必要です',
  );

const command = process.platform === 'win32' ? 'playwright.cmd' : 'playwright';
const result = spawnSync(
  command,
  ['test', '--config=playwright.config.ts', '--project', environment],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, E2E_ENV: environment },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
