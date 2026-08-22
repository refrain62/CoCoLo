import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

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
END
$$;
GRANT USAGE ON SCHEMA public TO cocolo_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO cocolo_app;
`;
const command = process.platform === 'win32' ? 'psql.exe' : 'psql';
const result = spawnSync(
  command,
  ['--no-psqlrc', '--dbname', process.env.DIRECT_URL, '--command', sql],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);
if (result.error) throw result.error;
assert.equal(result.status, 0, 'テストDBのRLS role準備に失敗しました');
console.log('テストDBのcocolo_app/RLS roleを準備しました。');
