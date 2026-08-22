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
  appRoleOwnsSchema: boolean;
  appRoleOwnsSequence: boolean;
  appRoleOwnsFunction: boolean;
  appRoleOwnsType: boolean;
  publicHasTableGrant: boolean;
  publicSchemaCreateGrant: boolean;
  publicSchemaAclDrift: boolean;
  publicSchemaOwnerIsApp: boolean;
  publicSequenceGrant: boolean;
  sequenceGrantDrift: boolean;
  rlsDrift: boolean;
  appTableGrants: readonly {
    tableName: string;
    privilegeType: string;
    isGrantable: boolean;
  }[];
  securityDefinerPublicExecute: boolean;
  securityDefinerAppExecute: boolean;
  securityDefinerOwnerIsApp: boolean;
  securityDefinerHasSafeSearchPath: boolean;
  securityDefinerUnexpectedFunction: boolean;
  securityDefinerUnexpectedGrant: boolean;
  securityDefinerAppGrantOption: boolean;
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
    inspection.appRoleOwnsSchema,
    false,
    'app roleがschema ownerです。',
  );
  assert.equal(
    inspection.appRoleOwnsSequence,
    false,
    'app roleがsequence ownerです。',
  );
  assert.equal(
    inspection.appRoleOwnsFunction,
    false,
    'app roleがfunction ownerです。',
  );
  assert.equal(
    inspection.appRoleOwnsType,
    false,
    'app roleがtype ownerです。',
  );
  assert.equal(
    inspection.publicHasTableGrant,
    false,
    'PUBLICへtable権限が付与されています。',
  );
  assert.equal(
    inspection.publicSchemaCreateGrant,
    false,
    'PUBLICへschema CREATE権限が付与されています。',
  );
  assert.equal(
    inspection.publicSchemaAclDrift,
    false,
    'public schemaのACLがowner/PUBLIC USAGE以外へ拡張されています。',
  );
  assert.equal(
    inspection.publicSchemaOwnerIsApp,
    false,
    'public schemaのownerをapp roleにしてはいけません。',
  );
  assert.equal(
    inspection.publicSequenceGrant,
    false,
    'PUBLICへsequence権限が付与されています。',
  );
  assert.equal(
    inspection.sequenceGrantDrift,
    false,
    'sequence grantが最小権限の正本と一致しません。',
  );
  assert.equal(
    inspection.rlsDrift,
    false,
    'RLSまたはpolicyがdriftしています。',
  );
  assert.deepEqual(
    grantKeys(inspection.appTableGrants),
    expectedTableGrants,
    'cocolo_appのtable grantが最小権限の正本と一致しません。',
  );
  assert.ok(
    inspection.appTableGrants.every((grant) => !grant.isGrantable),
    'cocolo_appへtableのGRANT OPTIONを付与してはいけません。',
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
  assert.equal(
    inspection.securityDefinerUnexpectedFunction,
    false,
    '未承認のSECURITY DEFINER関数があります。',
  );
  assert.equal(
    inspection.securityDefinerUnexpectedGrant,
    false,
    'SECURITY DEFINER関数に想定外のACLがあります。',
  );
  assert.equal(
    inspection.securityDefinerAppGrantOption,
    false,
    'app roleへSECURITY DEFINER関数のGRANT OPTIONを付与してはいけません。',
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

export async function inspectDatabase(
  directUrl = process.env.DIRECT_URL,
): Promise<DatabaseSecurityInspection> {
  assert.ok(directUrl, 'DB security検査にはDIRECT_URLが必要です。');
  const PrismaClient = loadPrismaClient();
  const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });
  try {
    const rows = await prisma.$queryRawUnsafe<DatabaseSecurityInspection[]>(`
      WITH app_role AS (
        SELECT oid, rolsuper, rolbypassrls, rolcreaterole,
               rolcreatedb, rolreplication
          FROM pg_roles
         WHERE rolname = 'cocolo_app'
      ),
      required_table(table_name) AS (
        VALUES ('tenants'), ('tenant_memberships'), ('members'),
               ('guardian_members'), ('audit_logs'), ('promotion_runs')
      ),
      required_policy(table_name, policy_name) AS (
        VALUES ('tenants', 'tenants_select'),
               ('tenant_memberships', 'tenant_memberships_select'),
               ('members', 'members_select'),
               ('members', 'members_write'),
               ('guardian_members', 'guardian_members_select'),
               ('audit_logs', 'audit_logs_owner_select'),
               ('audit_logs', 'audit_logs_insert'),
               ('promotion_runs', 'promotion_runs_admin_write')
      ),
      rls_policy_source AS (
        SELECT tablename,
               policyname,
               cmd,
               concat_ws(' ', coalesce(qual, ''), coalesce(with_check, '')) AS policy_text,
               regexp_replace(
                 lower(concat_ws(' ', coalesce(qual, ''), coalesce(with_check, ''))),
                 '[[:space:]]+', '', 'g'
               ) AS normalized_policy_text
          FROM pg_policies
         WHERE schemaname = 'public'
      ),
      rls_policy AS (
        SELECT tablename,
               count(*) AS policy_count,
               bool_or(
                 position('app.tenant_id' IN lower(policy_text)) = 0
                 OR (
                   cmd <> 'SELECT'
                   AND position('app.role' IN lower(policy_text)) = 0
                 )
                 OR normalized_policy_text ~ '(^|[^a-z_])([a-z_][a-z0-9_]*\\.)?tenant_id=([a-z_][a-z0-9_]*\\.)?tenant_id([^a-z_]|$)'
                 OR position(
                      'current_setting(''app.role'',true)=current_setting(''app.role'',true)'
                      IN normalized_policy_text
                    ) > 0
               ) AS policy_drift
          FROM rls_policy_source
         GROUP BY tablename
      ),
      rls_table AS (
        SELECT rt.table_name,
               c.relrowsecurity,
               c.relforcerowsecurity,
               coalesce(rp.policy_count, 0) AS policy_count,
               coalesce(rp.policy_drift, true) AS policy_drift,
               (SELECT count(*) FROM required_policy p
                 WHERE p.table_name = rt.table_name) AS required_policy_count,
               (SELECT count(*) FROM rls_policy_source p
                 JOIN required_policy r
                   ON r.table_name = p.tablename
                  AND r.policy_name = p.policyname
                WHERE p.tablename = rt.table_name) AS matching_policy_count
          FROM required_table rt
          LEFT JOIN pg_namespace n ON n.nspname = 'public'
          LEFT JOIN pg_class c
            ON c.relname = rt.table_name AND c.relnamespace = n.oid
          LEFT JOIN rls_policy rp ON rp.tablename = rt.table_name
      ),
      security_function AS (
        SELECT p.oid,
               n.nspname AS schema_name,
               p.proname,
               p.proowner,
               p.proconfig,
               p.proacl,
               pg_get_function_identity_arguments(p.oid) AS identity_arguments
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      ),
      security_function_acl AS (
        SELECT f.oid,
               f.proname,
               f.proowner,
               f.identity_arguments,
               a.grantee,
               a.privilege_type,
               a.is_grantable
          FROM security_function f
          CROSS JOIN LATERAL aclexplode(
            coalesce(f.proacl, acldefault('f', f.proowner))
          ) a
      ),
      app_grants AS (
        SELECT table_name AS "tableName",
               privilege_type AS "privilegeType",
               is_grantable = 'YES' AS "isGrantable"
          FROM information_schema.role_table_grants
         WHERE grantee = 'cocolo_app' AND table_schema = 'public'
      ),
      public_schema_acl AS (
        SELECT a.grantee, a.privilege_type, a.is_grantable, n.nspowner
          FROM pg_namespace n
          CROSS JOIN LATERAL aclexplode(
            coalesce(n.nspacl, acldefault('n', n.nspowner))
          ) a
         WHERE n.nspname = 'public'
      ),
      public_sequence_acl AS (
        SELECT c.oid, c.relowner, a.grantee, a.privilege_type, a.is_grantable
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          CROSS JOIN LATERAL aclexplode(
            coalesce(c.relacl, acldefault('S', c.relowner))
          ) a
         WHERE n.nspname = 'public' AND c.relkind = 'S'
      ),
      public_sequence AS (
        SELECT c.oid, c.relowner
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'S'
      )
      SELECT current_user AS "currentUser",
             EXISTS (SELECT 1 FROM app_role) AS "appRoleExists",
             coalesce((SELECT rolsuper FROM app_role), true) AS "appRoleIsSuperuser",
             coalesce((SELECT rolbypassrls FROM app_role), true) AS "appRoleBypassesRls",
             coalesce((SELECT rolcreaterole FROM app_role), true) AS "appRoleCanCreateRole",
             coalesce((SELECT rolcreatedb FROM app_role), true) AS "appRoleCanCreateDatabase",
             coalesce((SELECT rolreplication FROM app_role), true) AS "appRoleCanReplicate",
             EXISTS (
               SELECT 1 FROM pg_auth_members m
                WHERE m.member = (SELECT oid FROM app_role)
             ) AS "appRoleHasMembership",
             EXISTS (
               SELECT 1
                 FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
                  AND c.relowner = (SELECT oid FROM app_role)
             ) AS "appRoleOwnsTable",
             EXISTS (
               SELECT 1 FROM pg_namespace
                WHERE nspname NOT IN ('pg_catalog', 'information_schema')
                  AND nspowner = (SELECT oid FROM app_role)
             ) AS "appRoleOwnsSchema",
             EXISTS (
               SELECT 1
                 FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                  AND c.relkind = 'S'
                  AND c.relowner = (SELECT oid FROM app_role)
             ) AS "appRoleOwnsSequence",
             EXISTS (
               SELECT 1
                 FROM pg_proc p
                 JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                  AND p.proowner = (SELECT oid FROM app_role)
             ) AS "appRoleOwnsFunction",
             EXISTS (
               SELECT 1
                 FROM pg_type t
                 JOIN pg_namespace n ON n.oid = t.typnamespace
                WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                  AND t.typowner = (SELECT oid FROM app_role)
             ) AS "appRoleOwnsType",
             EXISTS (
               SELECT 1
                 FROM information_schema.table_privileges
                WHERE grantee = 'PUBLIC' AND table_schema = 'public'
             ) AS "publicHasTableGrant",
             EXISTS (
               SELECT 1 FROM public_schema_acl
                WHERE grantee = 0 AND privilege_type = 'CREATE'
             ) AS "publicSchemaCreateGrant",
             EXISTS (
               SELECT 1
                 FROM public_schema_acl a
                WHERE (a.grantee = 0 AND (a.privilege_type <> 'USAGE' OR a.is_grantable))
                   OR (a.grantee = (SELECT oid FROM app_role)
                       AND (a.privilege_type <> 'USAGE' OR a.is_grantable))
                   OR (a.grantee <> 0
                       AND a.grantee <> a.nspowner
                       AND a.grantee <> (SELECT oid FROM app_role)
                       AND a.grantee <> coalesce((SELECT oid FROM pg_roles WHERE rolname = 'pg_database_owner'), -1))
             )
             OR NOT EXISTS (
               SELECT 1 FROM public_schema_acl
                WHERE grantee = 0 AND privilege_type = 'USAGE'
             ) AS "publicSchemaAclDrift",
             coalesce((
               SELECT nspowner = (SELECT oid FROM app_role)
                 FROM pg_namespace
                WHERE nspname = 'public'
             ), true) AS "publicSchemaOwnerIsApp",
             EXISTS (
               SELECT 1 FROM public_sequence_acl
                WHERE grantee = 0 AND privilege_type IN ('USAGE', 'SELECT', 'UPDATE')
             ) AS "publicSequenceGrant",
             EXISTS (
               SELECT 1
                 FROM public_sequence s
                WHERE NOT EXISTS (
                        SELECT 1 FROM public_sequence_acl a
                         WHERE a.oid = s.oid
                           AND a.grantee = (SELECT oid FROM app_role)
                           AND a.privilege_type = 'USAGE'
                      )
                   OR NOT EXISTS (
                        SELECT 1 FROM public_sequence_acl a
                         WHERE a.oid = s.oid
                           AND a.grantee = (SELECT oid FROM app_role)
                           AND a.privilege_type = 'SELECT'
                      )
                   OR EXISTS (
                        SELECT 1 FROM public_sequence_acl a
                         WHERE a.oid = s.oid
                           AND a.grantee = (SELECT oid FROM app_role)
                           AND (a.privilege_type NOT IN ('USAGE', 'SELECT') OR a.is_grantable)
                      )
                   OR EXISTS (
                        SELECT 1 FROM public_sequence_acl a
                         WHERE a.oid = s.oid
                           AND a.grantee NOT IN (0, s.relowner, (SELECT oid FROM app_role))
                      )
             ) AS "sequenceGrantDrift",
             EXISTS (
               SELECT 1 FROM rls_table
                WHERE NOT coalesce(relrowsecurity, false)
                   OR NOT coalesce(relforcerowsecurity, false)
                   OR policy_count = 0
                   OR policy_count <> required_policy_count
                   OR matching_policy_count <> required_policy_count
                   OR policy_drift
             ) AS "rlsDrift",
             coalesce(
               (SELECT json_agg(json_build_object('tableName', "tableName", 'privilegeType', "privilegeType")) FROM app_grants),
               '[]'::json
             ) AS "appTableGrants",
             coalesce((
               SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE')
                 FROM security_function_acl a
             ), false) AS "securityDefinerPublicExecute",
             coalesce((
               SELECT bool_and(EXISTS (
                 SELECT 1 FROM security_function_acl a
                  WHERE a.oid = f.oid
                    AND a.grantee = (SELECT oid FROM app_role)
                    AND a.privilege_type = 'EXECUTE'
                    AND NOT a.is_grantable
               ))
                 FROM security_function f
             ), true) AS "securityDefinerAppExecute",
             coalesce((
               SELECT bool_or(f.proowner = (SELECT oid FROM app_role))
                 FROM security_function f
             ), false) AS "securityDefinerOwnerIsApp",
             coalesce((
               SELECT bool_and(f.proconfig = ARRAY['search_path=pg_catalog, public'])
                 FROM security_function f
             ), true) AS "securityDefinerHasSafeSearchPath",
             coalesce((
               SELECT bool_or(
                 f.schema_name <> 'public'
                 OR f.proname <> 'app_resolve_active_membership'
                 OR f.identity_arguments <> 'p_user_id text'
               )
                 FROM security_function f
             ), false) AS "securityDefinerUnexpectedFunction",
             coalesce((
               SELECT bool_or(
                 a.grantee NOT IN (0, f.proowner, coalesce((SELECT oid FROM app_role), -1))
                 OR a.privilege_type <> 'EXECUTE'
               )
                 FROM security_function_acl a
                 JOIN security_function f ON f.oid = a.oid
             ), false) AS "securityDefinerUnexpectedGrant",
             coalesce((
               SELECT bool_or(a.grantee = (SELECT oid FROM app_role) AND a.is_grantable)
                 FROM security_function_acl a
             ), false) AS "securityDefinerAppGrantOption"
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
