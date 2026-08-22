import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const expectedMajor = Number(
  process.argv[process.argv.indexOf('--expected-major') + 1] ?? 17,
);
assert.ok(Number.isInteger(expectedMajor) && expectedMajor > 0);
assert.ok(process.env.DATABASE_URL, 'DATABASE_URL が必要です');
const dockerContainer = process.env.PSQL_DOCKER_CONTAINER;
const dockerDatabase = process.env.PSQL_DOCKER_DATABASE ?? 'postgres';
const command = dockerContainer
  ? process.platform === 'win32'
    ? 'docker.exe'
    : 'docker'
  : process.platform === 'win32'
    ? 'psql.exe'
    : 'psql';
const args = dockerContainer
  ? [
      'exec',
      dockerContainer,
      'psql',
      '--no-psqlrc',
      '--tuples-only',
      '--no-align',
      '--username',
      'postgres',
      '--dbname',
      dockerDatabase,
      '--command',
      'SHOW server_version_num;',
    ]
  : [
      '--no-psqlrc',
      '--tuples-only',
      '--no-align',
      '--dbname',
      process.env.DATABASE_URL,
      '--command',
      'SHOW server_version_num;',
    ];
const result = spawnSync(command, args, {
  encoding: 'utf8',
  shell: process.platform === 'win32' && !dockerContainer,
});
if (result.error) throw result.error;
assert.equal(result.status, 0, result.stderr || 'PostgreSQLへ接続できません');
const serverVersion = Number(result.stdout.trim());
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
