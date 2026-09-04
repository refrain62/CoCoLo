import assert from 'node:assert/strict';
import { withPostgresClient } from './postgres-client.ts';

// migration/RLSの前提であるPostgreSQL major versionを、接続先DBそのものへ問い合わせて確認する。
const expectedMajor = Number(
  process.argv[process.argv.indexOf('--expected-major') + 1] ?? 17,
);
assert.ok(Number.isInteger(expectedMajor) && expectedMajor > 0);
assert.ok(process.env.DATABASE_URL, 'DATABASE_URL が必要です');
const rows = await withPostgresClient(process.env.DATABASE_URL, (client) =>
  client.$queryRawUnsafe<readonly [{ serverVersion: string }]>(
    'SELECT current_setting(\'server_version_num\') AS "serverVersion"',
  ),
);
const serverVersion = Number(rows[0]?.serverVersion);
assert.ok(
  Number.isInteger(serverVersion) && serverVersion > 0,
  'PostgreSQLのバージョンを取得できません',
);
assert.equal(
  Math.floor(serverVersion / 10000),
  expectedMajor,
  `PostgreSQL ${expectedMajor}系が必要です`,
);
console.log(`PostgreSQL ${expectedMajor}系を検証しました。`);
