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
const fixturePassword = process.env.COCOLO_FIXTURE_PASSWORD ?? 'cocolo_fixture';
const workerPassword =
  process.env.LINE_DELIVERY_WORKER_PASSWORD ?? 'line_delivery_worker';

// migration ownerはSupabase localで明示的に有効化し、CIの既存security期待値には追加しない。
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
    CREATE ROLE cocolo_migration LOGIN PASSWORD ${quoteLiteral(migrationPassword)} NOSUPERUSER NOBYPASSRLS;
  ELSE
    ALTER ROLE cocolo_migration LOGIN PASSWORD ${quoteLiteral(migrationPassword)} NOSUPERUSER NOBYPASSRLS;
  END IF;`
      : ''
  }
  ${
    migrationRole
      ? `IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cocolo_fixture') THEN
    CREATE ROLE cocolo_fixture LOGIN PASSWORD ${quoteLiteral(fixturePassword)} NOSUPERUSER BYPASSRLS;
  ELSE
    ALTER ROLE cocolo_fixture LOGIN PASSWORD ${quoteLiteral(fixturePassword)} NOSUPERUSER BYPASSRLS;
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
END
$$;
`;
const grants = [
  ...(migrationRole
    ? [
        'GRANT USAGE, CREATE ON SCHEMA public TO cocolo_migration',
        'GRANT USAGE ON SCHEMA extensions TO cocolo_migration',
        'GRANT USAGE ON SCHEMA public TO cocolo_fixture',
        `DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['tenants', 'tenant_memberships', 'members', 'guardian_members'] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO cocolo_fixture',
        table_name
      );
    END IF;
  END LOOP;
END
$$;`,
      ]
    : []),
  'GRANT USAGE ON SCHEMA public TO cocolo_app',
  'GRANT USAGE ON SCHEMA public TO line_delivery_worker',
  'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM line_delivery_worker',
];

await withPostgresClient(process.env.DIRECT_URL, async (client) => {
  if (migrationCompatibilitySql)
    await client.$executeRawUnsafe(migrationCompatibilitySql);
  await client.$executeRawUnsafe(roleSql);
  for (const statement of grants) await client.$executeRawUnsafe(statement);
});
console.log('テストDBのmigration、app、worker roleを準備しました。');
