import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// localは破棄専用Supabase stack、stagingは実環境だけを対象にし、productionへE2Eを誤接続させない。
const environment = process.argv[2];
assert.ok(environment === 'local' || environment === 'staging');
assert.notEqual(
  process.env.APP_ENV,
  'production',
  'production 環境から E2E テストを起動できません。',
);
if (environment === 'staging')
  assert.ok(
    process.env.STAGING_BASE_URL,
    'staging 環境の E2E テストには STAGING_BASE_URL が必要です。',
  );

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const command =
  environment === 'local'
    ? process.execPath
    : process.platform === 'win32'
      ? 'playwright.cmd'
      : 'playwright';
const args =
  environment === 'local'
    ? [path.join(root, 'scripts', 'supabase-local.ts'), 'e2e']
    : ['test', '--config=playwright.config.ts', '--project', environment];
const result = spawnSync(command, args, {
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    APP_ENV: environment,
    E2E_ENV: environment,
    ...(environment === 'local'
      ? {
          E2E_TEST_EMAIL: 'owner-a@example.test',
          E2E_TEST_PASSWORD: 'owner-password',
        }
      : {}),
  },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
