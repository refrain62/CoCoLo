import assert from 'node:assert/strict';

const loopbackHosts = new Set(['127.0.0.1', 'localhost']);
const allowedDatabaseNames = new Set([
  'postgres',
  'cocolo_local',
  'cocolo_test',
]);
const allowedPorts = new Set(['5432', '54322', '55322']);

export type TestDatabaseGuardOptions = {
  databaseUrl?: string;
  directUrl?: string;
  requireResetApproval?: boolean;
};

function assertLoopbackPostgresUrl(name: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} はPostgreSQL URLである必要があります。`);
  }
  assert.equal(url.protocol, 'postgresql:', `${name} のschemeが不正です。`);
  assert.ok(
    loopbackHosts.has(url.hostname),
    `${name} はloopbackに限定します。`,
  );
  assert.ok(
    allowedPorts.has(url.port),
    `${name} のportがテスト用ではありません。`,
  );
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  assert.ok(
    allowedDatabaseNames.has(databaseName),
    `${name} のdatabase名がテスト用ではありません。`,
  );
  return url;
}

// fixture・role操作はloopbackの明示的なテストDBだけに許可し、本番URLの誤接続をfail-closedにする。
export function assertTestDatabaseTarget(
  options: TestDatabaseGuardOptions = {},
): void {
  assert.notEqual(
    process.env.APP_ENV,
    'staging',
    'staging環境ではテストDB操作を実行できません。',
  );
  assert.notEqual(
    process.env.APP_ENV,
    'production',
    'production環境ではテストDB操作を実行できません。',
  );

  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  const directUrl = options.directUrl ?? process.env.DIRECT_URL;
  assert.ok(databaseUrl, 'DATABASE_URL が必要です。');
  assert.ok(directUrl, 'DIRECT_URL が必要です。');
  const database = assertLoopbackPostgresUrl('DATABASE_URL', databaseUrl);
  const direct = assertLoopbackPostgresUrl('DIRECT_URL', directUrl);
  assert.equal(database.hostname, direct.hostname);
  assert.equal(database.port, direct.port);

  const stackProject = process.env.TEST_STACK_PROJECT?.trim();
  if (stackProject)
    assert.ok(
      stackProject === 'cocolo-local' || stackProject === 'cocolo-test',
      'TEST_STACK_PROJECT が許可されていません。',
    );
  if (options.requireResetApproval)
    assert.equal(
      process.env.TEST_DATABASE_RESET_ALLOWED,
      'true',
      'テストDBの再構築にはTEST_DATABASE_RESET_ALLOWED=trueが必要です。',
    );
}
