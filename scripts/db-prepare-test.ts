import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// migration owner接続でアプリroleとworker専用roleを準備し、どちらにもRLS bypassを与えない。
assert.ok(process.env.DATABASE_URL, 'DATABASE_URL が必要です');
assert.ok(process.env.DIRECT_URL, 'DIRECT_URL が必要です');
const sql = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cocolo_app') THEN
    CREATE ROLE cocolo_app LOGIN PASSWORD 'cocolo_app' NOSUPERUSER NOBYPASSRLS;
  ELSE
    ALTER ROLE cocolo_app NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'line_delivery_worker') THEN
    CREATE ROLE line_delivery_worker LOGIN PASSWORD 'line_delivery_worker' NOSUPERUSER NOBYPASSRLS NOINHERIT;
  ELSE
    ALTER ROLE line_delivery_worker NOSUPERUSER NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO cocolo_app;
GRANT USAGE ON SCHEMA public TO line_delivery_worker;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM line_delivery_worker;
`;
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
      '--username',
      'postgres',
      '--dbname',
      dockerDatabase,
      '--command',
      sql,
    ]
  : ['--no-psqlrc', '--dbname', process.env.DIRECT_URL, '--command', sql];
const result = spawnSync(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32' && !dockerContainer,
});
if (result.error) throw result.error;
assert.equal(result.status, 0, 'テスト DB の RLS 用ロール準備に失敗しました。');
console.log('テスト DB の cocolo_app ロールと RLS 用ロールを準備しました。');
