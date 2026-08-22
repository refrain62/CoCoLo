import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertDeployedDatabaseConfiguration } from './verify-deployed-database-security.ts';

const safeEnvironment = {
  APP_ENV: 'staging',
  DEPLOY_ENV: 'staging',
  DEPLOYMENT_APPROVED: 'staging-approved',
  GITHUB_ACTIONS: 'true',
  DIRECT_URL: 'postgresql://postgres:secret@db.example.test:5432/cocolo',
};

test('deploy後実DB検査は検証済み環境とDIRECT_URLを要求する', () => {
  assert.deepEqual(assertDeployedDatabaseConfiguration(safeEnvironment), {
    environment: 'staging',
    directUrl: safeEnvironment.DIRECT_URL,
  });
});

test('未設定・local DB・未承認環境の悪性fixtureを拒否する', () => {
  for (const change of [
    { DIRECT_URL: '' },
    { DIRECT_URL: 'postgresql://postgres:secret@localhost:5432/cocolo' },
    { DEPLOY_ENV: 'local' },
    { DEPLOYMENT_APPROVED: '' },
    { GITHUB_ACTIONS: 'false' },
  ])
    assert.throws(() =>
      assertDeployedDatabaseConfiguration({ ...safeEnvironment, ...change }),
    );
});
