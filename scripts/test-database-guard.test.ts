import assert from 'node:assert/strict';
import test from 'node:test';
import { assertTestDatabaseTarget } from './test-database-guard.ts';

const valid = {
  APP_ENV: 'local',
  DATABASE_URL: 'postgresql://cocolo_app:cocolo_app@127.0.0.1:55322/postgres',
  DIRECT_URL: 'postgresql://postgres:postgres@127.0.0.1:55322/postgres',
  TEST_STACK_PROJECT: 'cocolo-test',
};

function withEnvironment(
  values: Record<string, string | undefined>,
  action: () => void,
) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    action();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('テストDBのloopback targetだけを許可する', () => {
  withEnvironment(valid, () =>
    assert.doesNotThrow(() => assertTestDatabaseTarget()),
  );
});

test('remote DB URLをfixture経路から拒否する', () => {
  withEnvironment(
    {
      ...valid,
      DIRECT_URL:
        'postgresql://postgres:postgres@db.example.test:5432/postgres',
    },
    () => assert.throws(() => assertTestDatabaseTarget(), /loopback/),
  );
});

test('productionのfixture実行を拒否する', () => {
  withEnvironment({ ...valid, APP_ENV: 'production' }, () =>
    assert.throws(() => assertTestDatabaseTarget(), /production/),
  );
});

test('再構築には明示承認を要求する', () => {
  withEnvironment({ ...valid, TEST_DATABASE_RESET_ALLOWED: undefined }, () =>
    assert.throws(
      () => assertTestDatabaseTarget({ requireResetApproval: true }),
      /TEST_DATABASE_RESET_ALLOWED/,
    ),
  );
});
