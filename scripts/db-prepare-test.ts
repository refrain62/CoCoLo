import assert from 'node:assert/strict';
import { withPostgresClient } from './postgres-client.ts';
import { assertTestDatabaseTarget } from './test-database-guard.ts';

assertTestDatabaseTarget();
assert.ok(process.env.DIRECT_URL, 'DIRECT_URL が必要です');

const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;
const appPassword = process.env.COCOLO_APP_PASSWORD ?? 'cocolo_app';
const migrationRole = process.env.COCOLO_MIGRATION_ROLE?.trim();
assert.ok(
  !migrationRole || migrationRole === 'cocolo_migration',
  'COCOLO_MIGRATION_ROLE が許可されていません。',
);
const migrationPassword =
  process.env.COCOLO_MIGRATION_PASSWORD ?? 'cocolo_migration';
const workerPassword =
  process.env.LINE_DELIVERY_WORKER_PASSWORD ?? 'line_delivery_worker';
const webhookReceiverPassword =
  process.env.LINE_WEBHOOK_RECEIVER_PASSWORD ?? 'line_webhook_receiver';

// migration ownerはSupabase localで明示的に有効化し、FORCE RLS下のsecurity definerを実行できるようにする。
const migrationCompatibilitySql = migrationRole
  ? `
DO $$
BEGIN
  -- Supabase localはpgcryptoをextensions schemaへ配置するため、既存migrationのpublic参照を互換化する。
  IF to_regprocedure('public.digest(text,text)') IS NULL
     AND to_regprocedure('extensions.digest(text,text)') IS NOT NULL THEN
    CREATE FUNCTION public.digest(data text, algorithm text)
    RETURNS bytea
    LANGUAGE sql
    IMMUTABLE
    STRICT
    PARALLEL SAFE
    AS 'SELECT extensions.digest($1, $2)';
  END IF;
END
$$;
`
  : '';
const roleSql = `
DO $$
BEGIN
  ${
    migrationRole
      ? `IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cocolo_migration') THEN
    CREATE ROLE cocolo_migration LOGIN PASSWORD ${quoteLiteral(migrationPassword)} NOSUPERUSER BYPASSRLS;
  ELSE
    ALTER ROLE cocolo_migration LOGIN PASSWORD ${quoteLiteral(migrationPassword)} NOSUPERUSER BYPASSRLS;
  END IF;`
      : ''
  }
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cocolo_app') THEN
    CREATE ROLE cocolo_app LOGIN PASSWORD ${quoteLiteral(appPassword)} NOSUPERUSER NOBYPASSRLS;
  ELSE
    ALTER ROLE cocolo_app LOGIN PASSWORD ${quoteLiteral(appPassword)} NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'line_delivery_worker') THEN
    CREATE ROLE line_delivery_worker LOGIN PASSWORD ${quoteLiteral(workerPassword)} NOSUPERUSER NOBYPASSRLS NOINHERIT;
  ELSE
    ALTER ROLE line_delivery_worker LOGIN PASSWORD ${quoteLiteral(workerPassword)} NOSUPERUSER NOBYPASSRLS NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'line_webhook_receiver') THEN
    CREATE ROLE line_webhook_receiver LOGIN PASSWORD ${quoteLiteral(webhookReceiverPassword)} NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;
  ELSE
    ALTER ROLE line_webhook_receiver LOGIN PASSWORD ${quoteLiteral(webhookReceiverPassword)} NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$$;
`;
const grants = [
  ...(migrationRole
    ? [
        'GRANT USAGE, CREATE ON SCHEMA public TO cocolo_migration',
        'GRANT USAGE ON SCHEMA extensions TO cocolo_migration',
      ]
    : []),
  'GRANT USAGE ON SCHEMA public TO cocolo_app',
  'GRANT USAGE ON SCHEMA public TO line_delivery_worker',
  'GRANT USAGE ON SCHEMA public TO line_webhook_receiver',
  'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM line_delivery_worker',
  'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM line_webhook_receiver',
];

await withPostgresClient(process.env.DIRECT_URL, async (client) => {
  if (migrationCompatibilitySql)
    await client.$executeRawUnsafe(migrationCompatibilitySql);
  await client.$executeRawUnsafe(roleSql);
  for (const statement of grants) await client.$executeRawUnsafe(statement);
});
console.log(
  'テストDBのmigration、app、worker、webhook receiver roleを準備しました。',
);
