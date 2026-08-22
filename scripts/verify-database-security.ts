import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type DatabaseSecurityInspection = Readonly<{
  currentUser: string;
  appRoleExists: boolean;
  appRoleIsSuperuser: boolean;
  appRoleBypassesRls: boolean;
  appRoleCanCreateRole: boolean;
  appRoleCanCreateDatabase: boolean;
  appRoleCanReplicate: boolean;
  appRoleHasMembership: boolean;
  appRoleOwnsTable: boolean;
  publicHasTableGrant: boolean;
  appTableGrants: readonly { tableName: string; privilegeType: string }[];
  securityDefinerPublicExecute: boolean;
  securityDefinerAppExecute: boolean;
  securityDefinerOwnerIsApp: boolean;
  securityDefinerHasSafeSearchPath: boolean;
}>;

const expectedTableGrants = new Set(
  [
    'tenants',
    'tenant_memberships',
    'members',
    'guardian_members',
    'audit_logs',
    'promotion_runs',
  ].flatMap((tableName) =>
    ['SELECT', 'INSERT', 'UPDATE'].map(
      (privilegeType) => `${tableName}:${privilegeType}`,
    ),
  ),
);

function grantKeys(
  grants: readonly { tableName: string; privilegeType: string }[],
) {
  return new Set(
    grants.map(
      (grant) => `${grant.tableName}:${grant.privilegeType.toUpperCase()}`,
    ),
  );
}

// migration owner接続で、app roleが管理者権限・role継承・table所有権を持たないことを確認する。
export function assertDatabaseSecurity(
  inspection: DatabaseSecurityInspection,
): void {
  assert.notEqual(
    inspection.currentUser,
    'cocolo_app',
    'DB security検査をapp role接続で実行してはいけません。',
  );
  assert.equal(inspection.appRoleExists, true, 'cocolo_app roleがありません。');
  assert.equal(
    inspection.appRoleIsSuperuser,
    false,
    'app roleがsuperuserです。',
  );
  assert.equal(
    inspection.appRoleBypassesRls,
    false,
    'app roleにBYPASSRLSがあります。',
  );
  assert.equal(
    inspection.appRoleCanCreateRole,
    false,
    'app roleにCREATEROLEがあります。',
  );
  assert.equal(
    inspection.appRoleCanCreateDatabase,
    false,
    'app roleにCREATEDBがあります。',
  );
  assert.equal(
    inspection.appRoleCanReplicate,
    false,
    'app roleにREPLICATIONがあります。',
  );
  assert.equal(
    inspection.appRoleHasMembership,
    false,
    'app roleにrole membershipがあります。',
  );
  assert.equal(
    inspection.appRoleOwnsTable,
    false,
    'app roleがtable ownerです。',
  );
  assert.equal(
    inspection.publicHasTableGrant,
    false,
    'PUBLICへtable権限が付与されています。',
  );
  assert.deepEqual(
    grantKeys(inspection.appTableGrants),
    expectedTableGrants,
    'cocolo_appのtable grantが最小権限の正本と一致しません。',
  );
  assert.equal(
    inspection.securityDefinerPublicExecute,
    false,
    'SECURITY DEFINER関数をPUBLICが実行できます。',
  );
  assert.equal(
    inspection.securityDefinerAppExecute,
    true,
    'SECURITY DEFINER関数のcocolo_app向けEXECUTEがありません。',
  );
  assert.equal(
    inspection.securityDefinerOwnerIsApp,
    false,
    'SECURITY DEFINER関数のownerをapp roleにしてはいけません。',
  );
  assert.equal(
    inspection.securityDefinerHasSafeSearchPath,
    true,
    'SECURITY DEFINER関数のsearch_pathが固定されていません。',
  );
}

type PrismaClientLike = Readonly<{
  $queryRawUnsafe: <T>(query: string) => Promise<T>;
  $disconnect: () => Promise<void>;
}>;

type PrismaClientConstructor = new (options: {
  datasources: { db: { url: string } };
}) => PrismaClientLike;

function loadPrismaClient(): PrismaClientConstructor {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const require = createRequire(
    path.join(root, 'packages', 'db', 'package.json'),
  );
  const loaded = require('@prisma/client') as {
    PrismaClient?: PrismaClientConstructor;
  };
  assert.ok(
    loaded.PrismaClient,
    'DB security検査用のPrisma Clientがありません。',
  );
  return loaded.PrismaClient;
}

async function inspectDatabase(
  directUrl = process.env.DIRECT_URL,
): Promise<DatabaseSecurityInspection> {
  assert.ok(directUrl, 'DB security検査にはDIRECT_URLが必要です。');
  const PrismaClient = loadPrismaClient();
  const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });
  try {
    const rows = await prisma.$queryRawUnsafe<DatabaseSecurityInspection[]>(`
      WITH app_role AS (
        SELECT oid, rolname, rolsuper, rolbypassrls, rolcreaterole,
               rolcreatedb, rolreplication
          FROM pg_roles
         WHERE rolname = 'cocolo_app'
      ),
      security_function AS (
        SELECT p.oid, p.proowner, p.prosecdef, p.proconfig, p.proacl
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'app_resolve_active_membership'
           AND pg_get_function_identity_arguments(p.oid) = 'p_user_id text'
      ),
      app_grants AS (
        SELECT table_name AS "tableName", privilege_type AS "privilegeType"
          FROM information_schema.role_table_grants
         WHERE grantee = 'cocolo_app' AND table_schema = 'public'
      )
      SELECT current_user AS "currentUser",
             EXISTS (SELECT 1 FROM app_role) AS "appRoleExists",
             COALESCE((SELECT rolsuper FROM app_role), true) AS "appRoleIsSuperuser",
             COALESCE((SELECT rolbypassrls FROM app_role), true) AS "appRoleBypassesRls",
             COALESCE((SELECT rolcreaterole FROM app_role), true) AS "appRoleCanCreateRole",
             COALESCE((SELECT rolcreatedb FROM app_role), true) AS "appRoleCanCreateDatabase",
             COALESCE((SELECT rolreplication FROM app_role), true) AS "appRoleCanReplicate",
             EXISTS (
               SELECT 1 FROM pg_auth_members m
                WHERE m.member = (SELECT oid FROM app_role)
             ) AS "appRoleHasMembership",
             EXISTS (
               SELECT 1
                 FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                  AND c.relkind IN ('r', 'p')
                  AND c.relowner = (SELECT oid FROM app_role)
             ) AS "appRoleOwnsTable",
             EXISTS (
               SELECT 1
                 FROM information_schema.table_privileges
                WHERE grantee = 'PUBLIC' AND table_schema = 'public'
             ) AS "publicHasTableGrant",
             COALESCE(
               (SELECT json_agg(json_build_object('tableName', "tableName", 'privilegeType', "privilegeType")) FROM app_grants),
               '[]'::json
             ) AS "appTableGrants",
             COALESCE((
               SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE')
                 FROM security_function f,
                      aclexplode(COALESCE(f.proacl, acldefault('f', f.proowner))) a
             ), false) AS "securityDefinerPublicExecute",
             COALESCE((
               SELECT bool_or(a.grantee = (SELECT oid FROM app_role) AND a.privilege_type = 'EXECUTE')
                 FROM security_function f,
                      aclexplode(COALESCE(f.proacl, acldefault('f', f.proowner))) a
             ), false) AS "securityDefinerAppExecute",
             COALESCE((SELECT proowner = (SELECT oid FROM app_role) FROM security_function), true) AS "securityDefinerOwnerIsApp",
             COALESCE((SELECT 'search_path=pg_catalog, public' = ANY(proconfig) FROM security_function), false) AS "securityDefinerHasSafeSearchPath"
      FROM (SELECT 1) AS singleton
    `);
    assert.equal(rows.length, 1, 'DB security検査の結果が一意ではありません。');
    const row = rows[0];
    assert.ok(row, 'DB security検査結果がありません。');
    return row;
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  assertDatabaseSecurity(await inspectDatabase());
  console.log(
    'DB role、owner、table grant、SECURITY DEFINER権限を検証しました。',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
