import assert from 'node:assert/strict';
import { withPostgresClient } from './postgres-client.ts';

// migration owner接続でRLS用のcocolo_app roleを準備し、アプリroleへbypass権限を与えない。
assert.ok(process.env.DATABASE_URL, 'DATABASE_URL が必要です');
assert.ok(process.env.DIRECT_URL, 'DIRECT_URL が必要です');
const roleSql = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cocolo_app') THEN
    CREATE ROLE cocolo_app LOGIN PASSWORD 'cocolo_app' NOSUPERUSER NOBYPASSRLS;
  ELSE
    ALTER ROLE cocolo_app NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
`;
await withPostgresClient(process.env.DIRECT_URL, async (client) => {
  await client.$executeRawUnsafe(roleSql);
  await client.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO cocolo_app');
  await client.$executeRawUnsafe(
    'GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO cocolo_app',
  );
});
console.log('テスト DB の cocolo_app ロールと RLS 用ロールを準備しました。');
