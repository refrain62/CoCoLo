import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import {
  type PrismaClientLike,
  withPostgresClient,
} from './postgres-client.ts';

export type ShadowRoleInspection = Readonly<{
  roleName: string;
  currentUser: string;
  isSuperuser: boolean;
  bypassRls: boolean;
  canCreateDatabase: boolean;
  canCreateRole: boolean;
  canReplicate: boolean;
  hasMembership: boolean;
  canLogin: boolean;
  hasPassword: boolean;
  passwordHashPrefix: string | null;
}>;

export type ShadowAclEntry = Readonly<{
  objectType: 'default' | 'schema' | 'table' | 'sequence' | 'enum';
  objectName: string;
  grantee: string;
  privilege: string;
}>;

export type ShadowObjectOwner = Readonly<{
  objectType: 'table' | 'sequence' | 'enum';
  objectName: string;
  owner: string;
}>;

export type ShadowMembership = Readonly<{
  roleName: string;
  memberName: string;
}>;

export type ShadowRlsInspection = Readonly<{
  tableName: string;
  enabled: boolean;
  forced: boolean;
}>;

export type ShadowDatabaseInspection = Readonly<{
  databaseOwner: string;
  objectOwners: readonly ShadowObjectOwner[];
  aclEntries: readonly ShadowAclEntry[];
  defaultAclEntries: readonly ShadowAclEntry[];
  memberships: readonly ShadowMembership[];
  rls: readonly ShadowRlsInspection[];
}>;

// Shadow roleはDDLを実行できるが、管理者権限・RLS迂回権限・他roleへの所属を持たないことを実DBで確認する。
export function assertShadowRoleAttributes(
  inspection: ShadowRoleInspection,
  expectedRole: string,
): void {
  assert.equal(
    inspection.currentUser,
    expectedRole,
    'Shadow DB接続roleが不一致です。',
  );
  assert.equal(
    inspection.roleName,
    expectedRole,
    'Shadow roleが存在しません。',
  );
  assert.equal(
    inspection.isSuperuser,
    false,
    'Shadow roleにsuperuser権限があります。',
  );
  assert.equal(
    inspection.bypassRls,
    false,
    'Shadow roleにbypassrls権限があります。',
  );
  assert.equal(
    inspection.canCreateDatabase,
    false,
    'Shadow roleにcreatedb権限があります。',
  );
  assert.equal(
    inspection.canCreateRole,
    false,
    'Shadow roleにcreaterole権限があります。',
  );
  assert.equal(
    inspection.canReplicate,
    false,
    'Shadow roleにreplication権限があります。',
  );
  assert.equal(
    inspection.hasMembership,
    false,
    'Shadow roleにrole membershipがあります。',
  );
  assert.equal(
    inspection.canLogin,
    true,
    'Shadow roleにLOGIN属性がありません。',
  );
  assert.equal(
    inspection.hasPassword,
    true,
    'Shadow roleにpassword認証情報がありません。',
  );
  assert.equal(
    inspection.passwordHashPrefix === 'SCRAM-SHA-256' ||
      inspection.passwordHashPrefix === '********',
    true,
    'Shadow roleはSCRAM-SHA-256 password認証を使用してください。',
  );
}

const expectedTablePrivileges = new Map<string, readonly string[]>([
  ['tenants', ['INSERT', 'SELECT', 'UPDATE']],
  ['tenant_memberships', ['INSERT', 'SELECT', 'UPDATE']],
  ['members', ['INSERT', 'SELECT', 'UPDATE']],
  ['guardian_members', ['INSERT', 'SELECT', 'UPDATE']],
  ['audit_logs', ['INSERT', 'SELECT']],
  ['promotion_runs', ['INSERT', 'SELECT', 'UPDATE']],
  ['attachments', ['DELETE', 'INSERT', 'SELECT', 'UPDATE']],
  ['events', ['INSERT', 'SELECT', 'UPDATE']],
  ['attendance_responses', ['INSERT', 'SELECT', 'UPDATE']],
  ['announcements', ['INSERT', 'SELECT', 'UPDATE']],
  ['announcement_attachments', ['INSERT', 'SELECT', 'UPDATE']],
  ['announcement_reads', ['INSERT', 'SELECT', 'UPDATE']],
  ['board_contacts', ['DELETE', 'INSERT', 'SELECT', 'UPDATE']],
  ['purchase_orders', ['INSERT', 'SELECT', 'UPDATE']],
  ['order_products', ['INSERT', 'SELECT', 'UPDATE']],
  ['order_entries', ['INSERT', 'SELECT', 'UPDATE']],
  ['order_lines', ['INSERT', 'SELECT', 'UPDATE']],
  ['order_idempotency_keys', ['INSERT', 'SELECT', 'UPDATE']],
  ['line_connections', ['INSERT', 'SELECT', 'UPDATE']],
  ['line_notification_queue', ['INSERT', 'SELECT', 'UPDATE']],
  ['line_webhook_receipts', ['INSERT', 'SELECT', 'UPDATE']],
  ['ride_plans', ['INSERT', 'SELECT', 'UPDATE']],
  ['ride_offers', ['INSERT', 'SELECT', 'UPDATE']],
  ['ride_requests', ['INSERT', 'SELECT', 'UPDATE']],
  ['ride_assignments', ['DELETE', 'INSERT', 'SELECT', 'UPDATE']],
]);

const expectedEnumNames = [
  'role',
  'membership_status',
  'member_category',
  'member_status',
  'promotion_run_status',
  'event_type',
  'attendance_response',
  'attachment_status',
  'announcement_status',
  'purchase_order_status',
  'payment_status',
  'line_connection_status',
  'line_notification_source',
  'line_notification_status',
  'ride_plan_status',
  'ride_offer_status',
  'ride_request_status',
];

export const expectedShadowObjectOwnerKeys = [
  'table:public._prisma_migrations',
  ...[...expectedTablePrivileges.keys()].map((name) => `table:public.${name}`),
  ...expectedEnumNames.map((name) => `enum:public.${name}`),
];

export const expectedShadowRlsTableNames = [
  ...[...expectedTablePrivileges.keys()].map((name) => `public.${name}`),
  'public.line_delivery_outbox',
];

export function buildExpectedShadowAclEntries(
  objectOwners: readonly ShadowObjectOwner[],
): ShadowAclEntry[] {
  const entries: ShadowAclEntry[] = [];
  entries.push({
    objectType: 'schema',
    objectName: 'public',
    grantee: 'cocolo_app',
    privilege: 'USAGE',
  });
  entries.push({
    objectType: 'schema',
    objectName: 'public',
    grantee: 'line_delivery_worker',
    privilege: 'USAGE',
  });
  for (const [tableName, privileges] of expectedTablePrivileges) {
    for (const privilege of privileges)
      entries.push({
        objectType: 'table',
        objectName: `public.${tableName}`,
        grantee: 'cocolo_app',
        privilege,
      });
  }
  for (const objectName of new Set(
    objectOwners
      .filter((entry) => entry.objectType === 'sequence')
      .map((entry) => entry.objectName),
  )) {
    for (const privilege of ['SELECT', 'USAGE'])
      entries.push({
        objectType: 'sequence',
        objectName,
        grantee: 'cocolo_app',
        privilege,
      });
  }
  for (const typeName of expectedEnumNames)
    entries.push({
      objectType: 'enum',
      objectName: `public.${typeName}`,
      grantee: 'cocolo_app',
      privilege: 'USAGE',
    });
  return entries;
}

function aclKey(entry: ShadowAclEntry): string {
  return `${entry.objectType}:${entry.objectName}:${entry.grantee}:${entry.privilege}`;
}

function objectOwnerKey(entry: ShadowObjectOwner): string {
  return `${entry.objectType}:${entry.objectName}`;
}

// PostgreSQL 17の初期クラスタが持つ監視用membershipだけを許可し、Shadow/app roleを含む追加行を拒否する。
const allowedMembershipKeys = [
  'pg_read_all_settings:pg_monitor',
  'pg_read_all_stats:pg_monitor',
  'pg_stat_scan_tables:pg_monitor',
];

function assertExactSet(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  assert.deepEqual(
    [...new Set(actual)].sort(),
    [...new Set(expected)].sort(),
    `${label}の許可集合が不一致です。`,
  );
}

export function assertShadowDatabaseSecurity(
  inspection: ShadowDatabaseInspection,
  expectedRole: string,
): void {
  assert.equal(
    inspection.databaseOwner,
    expectedRole,
    'Shadow DBのownerはShadow roleでなければなりません。',
  );
  assert.ok(
    inspection.objectOwners.length > 0,
    'Shadow DBの検査対象objectがありません。',
  );
  assertExactSet(
    inspection.objectOwners.map(objectOwnerKey),
    expectedShadowObjectOwnerKeys,
    'Shadow DB objectの種類・名前',
  );
  assertExactSet(
    inspection.objectOwners.map((entry) => entry.owner),
    inspection.objectOwners.map(() => expectedRole),
    'Shadow DB object owner',
  );
  assertExactSet(
    inspection.defaultAclEntries.map(aclKey),
    [],
    'Shadow DB default privileges',
  );
  assertExactSet(
    inspection.memberships.map(
      (entry) => `${entry.roleName}:${entry.memberName}`,
    ),
    allowedMembershipKeys,
    'Shadow DB pg_auth_members',
  );
  assert.deepEqual(
    [...new Set(inspection.aclEntries.map(aclKey))].sort(),
    buildExpectedShadowAclEntries(inspection.objectOwners).map(aclKey).sort(),
    'Shadow DB ACLの許可集合が不一致です。PUBLIC grantや過剰権限を拒否します。',
  );
  assert.ok(
    inspection.aclEntries.every((entry) => entry.grantee !== 'PUBLIC'),
    'Shadow DB objectへのPUBLIC grantを拒否します。',
  );
  assertExactSet(
    inspection.rls.map((table) => table.tableName),
    expectedShadowRlsTableNames,
    'Shadow DB RLS検査対象table',
  );
  for (const table of inspection.rls) {
    assert.equal(
      table.enabled,
      true,
      `${table.tableName}: RLS無効化を拒否します。`,
    );
    assert.equal(
      table.forced,
      true,
      `${table.tableName}: FORCE RLS未設定を拒否します。`,
    );
  }
}

export function assertMigrationSqlSafe(
  sql: string,
  file = 'migration.sql',
): void {
  const dangerousPatterns = [
    /\bDROP\s+(?:TABLE|SCHEMA|DATABASE)\b/i,
    /\bTRUNCATE\b/i,
    /\bDELETE\s+FROM\s+[^;]+;/is,
    /\b(?:CREATE|ALTER|DROP)\s+ROLE\b/i,
    /\bALTER\s+DATABASE\b/i,
    /\bALTER\s+DEFAULT\s+PRIVILEGES\b/i,
    /\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i,
    /\bGRANT\b[^;]+\bTO\s+PUBLIC\b/is,
  ];
  for (const pattern of dangerousPatterns)
    assert.doesNotMatch(sql, pattern, `${file}: 危険なDDLを拒否します。`);
}

async function inspectShadowDatabase(
  client: PrismaClientLike,
): Promise<ShadowDatabaseInspection> {
  const [
    databaseRows,
    objectOwners,
    aclEntries,
    defaultAclEntries,
    memberships,
    rls,
  ] = await Promise.all([
    client.$queryRawUnsafe<readonly [{ databaseOwner: string }]>(
      'SELECT pg_get_userbyid(datdba) AS "databaseOwner" FROM pg_database WHERE datname = current_database()',
    ),
    client.$queryRawUnsafe<ShadowObjectOwner[]>(
      `SELECT 'table'::text AS "objectType", n.nspname || '.' || c.relname AS "objectName", pg_get_userbyid(c.relowner) AS owner
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'f', 'p')
          UNION ALL
         SELECT 'sequence'::text, n.nspname || '.' || c.relname, pg_get_userbyid(c.relowner)
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'S'
          UNION ALL
         SELECT 'enum'::text, n.nspname || '.' || t.typname, pg_get_userbyid(t.typowner)
           FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public' AND t.typtype = 'e'`,
    ),
    client.$queryRawUnsafe<ShadowAclEntry[]>(
      `SELECT 'schema'::text AS "objectType", n.nspname AS "objectName",
                CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee, x.privilege_type AS privilege
           FROM pg_namespace n
           CROSS JOIN LATERAL aclexplode(n.nspacl) x
          WHERE n.nspname = 'public' AND x.grantee <> n.nspowner
          UNION ALL
         SELECT 'table'::text, n.nspname || '.' || c.relname,
                CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee, x.privilege_type AS privilege
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           CROSS JOIN LATERAL aclexplode(c.relacl) x
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'f', 'p') AND x.grantee <> c.relowner
          UNION ALL
         SELECT 'sequence'::text, n.nspname || '.' || c.relname, CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END, x.privilege_type
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           CROSS JOIN LATERAL aclexplode(c.relacl) x
          WHERE n.nspname = 'public' AND c.relkind = 'S' AND x.grantee <> c.relowner
          UNION ALL
         SELECT 'enum'::text, n.nspname || '.' || t.typname, CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END, x.privilege_type
           FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           CROSS JOIN LATERAL aclexplode(t.typacl) x
           WHERE n.nspname = 'public' AND t.typtype = 'e' AND x.grantee <> t.typowner`,
    ),
    client.$queryRawUnsafe<ShadowAclEntry[]>(
      `SELECT 'default'::text AS "objectType", COALESCE(n.nspname, '*') AS "objectName",
                COALESCE(pg_get_userbyid(x.grantee), 'PUBLIC') AS grantee, x.privilege_type AS privilege
           FROM pg_default_acl d
           LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
           CROSS JOIN LATERAL aclexplode(d.defaclacl) x`,
    ),
    client.$queryRawUnsafe<ShadowMembership[]>(
      `SELECT pg_get_userbyid(roleid) AS "roleName", pg_get_userbyid(member) AS "memberName"
           FROM pg_auth_members`,
    ),
    client.$queryRawUnsafe<ShadowRlsInspection[]>(
      `SELECT n.nspname || '.' || c.relname AS "tableName", c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
          ORDER BY c.relname`,
    ),
  ]);
  return {
    databaseOwner: databaseRows[0]?.databaseOwner ?? '',
    objectOwners,
    aclEntries,
    defaultAclEntries,
    memberships,
    rls,
  };
}

export async function inspectShadowRole(
  shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL,
  expectedRole = process.env.SHADOW_DATABASE_ROLE,
  adminDatabaseUrl = process.env.SHADOW_DATABASE_ADMIN_URL,
): Promise<void> {
  assert.ok(shadowDatabaseUrl, 'SHADOW_DATABASE_URLが必要です。');
  assert.ok(expectedRole, 'SHADOW_DATABASE_ROLEが必要です。');
  assert.ok(
    adminDatabaseUrl,
    'SCRAM password方式の実DB検証にはSHADOW_DATABASE_ADMIN_URLが必要です。',
  );
  assert.match(expectedRole, /^[a-z_][a-z0-9_]*$/, 'Shadow role名が不正です。');

  await withPostgresClient(shadowDatabaseUrl, async (prisma) => {
    const rows = await prisma.$queryRawUnsafe<ShadowRoleInspection[]>(
      `SELECT r.rolname AS "roleName",
              current_user AS "currentUser",
              r.rolsuper AS "isSuperuser",
              r.rolbypassrls AS "bypassRls",
              r.rolcreatedb AS "canCreateDatabase",
              r.rolcreaterole AS "canCreateRole",
              r.rolreplication AS "canReplicate",
              r.rolcanlogin AS "canLogin",
              (r.rolpassword IS NOT NULL) AS "hasPassword",
              split_part(r.rolpassword, '$', 1) AS "passwordHashPrefix",
              EXISTS (
                SELECT 1
                  FROM pg_auth_members m
                 WHERE m.member = r.oid
              ) AS "hasMembership"
         FROM pg_roles r
        WHERE r.rolname = $1`,
      expectedRole,
    );
    assert.equal(rows.length, 1, 'Shadow roleが見つかりません。');
    assertShadowRoleAttributes(rows[0] as ShadowRoleInspection, expectedRole);
    const adminRows = await withPostgresClient(adminDatabaseUrl, (admin) =>
      admin.$queryRawUnsafe<readonly [{ passwordHashPrefix: string | null }]>(
        `SELECT split_part(rolpassword, '$', 1) AS "passwordHashPrefix"
           FROM pg_authid
          WHERE rolname = $1`,
        expectedRole,
      ),
    );
    assert.equal(
      adminRows[0]?.passwordHashPrefix,
      'SCRAM-SHA-256',
      'Shadow roleの実password hashはSCRAM-SHA-256でなければなりません。',
    );
    assertShadowDatabaseSecurity(
      await inspectShadowDatabase(prisma),
      expectedRole,
    );
  });
}

async function main(): Promise<void> {
  await inspectShadowRole();
  console.log('Shadow roleの属性とmembershipを実DBで検証しました。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
