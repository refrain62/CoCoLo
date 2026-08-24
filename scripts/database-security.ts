import assert from 'node:assert/strict';
import {
  type PrismaClientLike,
  withPostgresClient,
} from './postgres-client.ts';

export type DatabaseIdentity = Readonly<{
  currentUser: string;
  currentDatabase: string;
  serverAddress: string | null;
  serverPort: number;
}>;

export type DatabaseRoleInspection = Readonly<{
  roleName: string;
  isSuperuser: boolean;
  bypassRls: boolean;
  canCreateDatabase: boolean;
  canCreateRole: boolean;
  canReplicate: boolean;
  canLogin: boolean;
  hasMembership: boolean;
}>;

export type DatabaseAclEntry = Readonly<{
  objectType: 'default' | 'schema' | 'table' | 'sequence' | 'enum' | 'function';
  objectName: string;
  grantee: string;
  privilege: string;
}>;

export type DatabaseObjectOwner = Readonly<{
  objectType: 'table' | 'sequence' | 'enum';
  objectName: string;
  owner: string;
}>;

export type DatabaseSchemaOwner = Readonly<{
  schemaName: string;
  owner: string;
}>;

export type DatabaseMembership = Readonly<{
  roleName: string;
  memberName: string;
}>;

export type DatabaseRlsInspection = Readonly<{
  tableName: string;
  enabled: boolean;
  forced: boolean;
}>;

export type DatabasePolicyInspection = Readonly<{
  tableName: string;
  policyName: string;
  permissive: string;
  roles: readonly string[];
  command: string;
  usingExpression: string | null;
  withCheckExpression: string | null;
}>;

export type DatabaseFunctionAcl = Readonly<{
  grantee: string;
  privilege: string;
}>;

export type DatabaseFunctionInspection = Readonly<{
  functionName: string;
  owner: string;
  securityDefiner: boolean;
  searchPathConfig: string | null;
  aclEntries: readonly DatabaseFunctionAcl[];
}>;

export type DatabaseSecurityInspection = Readonly<{
  appIdentity: DatabaseIdentity;
  adminIdentity: DatabaseIdentity;
  appRole: DatabaseRoleInspection;
  databaseOwner: string;
  schemaOwner: string;
  schemaOwners: readonly DatabaseSchemaOwner[];
  objectOwners: readonly DatabaseObjectOwner[];
  aclEntries: readonly DatabaseAclEntry[];
  defaultAclEntries: readonly DatabaseAclEntry[];
  memberships: readonly DatabaseMembership[];
  rls: readonly DatabaseRlsInspection[];
  policies: readonly DatabasePolicyInspection[];
  functions: readonly DatabaseFunctionInspection[];
}>;

export type DatabaseSecurityOptions = Readonly<{
  appRole?: string;
  adminRole?: string;
  environment?: string;
  allowedHosts?: string;
  allowedDatabases?: string;
  allowedTargets?: string;
}>;

type DatabaseTarget = Readonly<{
  host: string;
  port: number;
  database: string;
  user: string;
  sslMode: string | null;
}>;

const appTableNames = [
  'public.tenants',
  'public.tenant_memberships',
  'public.members',
  'public.guardian_members',
  'public.audit_logs',
  'public.promotion_runs',
] as const;

const appEnumNames = [
  'public.role',
  'public.membership_status',
  'public.member_category',
  'public.member_status',
  'public.promotion_run_status',
] as const;

const appGuardFunctionName = 'public.app_guard_promotion_run_transition()';
const appTableNameValues = appTableNames.map((name) =>
  name.slice('public.'.length),
);
const appEnumNameValues = appEnumNames.map((name) =>
  name.slice('public.'.length),
);

const allowedMembershipKeys = [
  'pg_read_all_settings:pg_monitor',
  'pg_read_all_stats:pg_monitor',
  'pg_stat_scan_tables:pg_monitor',
];

type PolicyExpectation = Readonly<{
  tableName: string;
  policyName: string;
  command: string;
  roles: readonly string[];
  usingMarkers: readonly string[];
  withCheckMarkers: readonly string[];
  usingRequired: boolean;
  withCheckRequired: boolean;
}>;

// policyの名前・commandだけでなく、実際のtenant/user/role境界を正本として検査する。
const expectedPolicies: readonly PolicyExpectation[] = [
  {
    tableName: 'public.tenants',
    policyName: 'tenants_select',
    command: 'SELECT',
    roles: ['public'],
    usingMarkers: ["current_setting('app.tenant_id'"],
    withCheckMarkers: [],
    usingRequired: true,
    withCheckRequired: false,
  },
  {
    tableName: 'public.tenant_memberships',
    policyName: 'tenant_memberships_select',
    command: 'SELECT',
    roles: ['public'],
    usingMarkers: [
      "current_setting('app.tenant_id'",
      "current_setting('app.user_id'",
    ],
    withCheckMarkers: [],
    usingRequired: true,
    withCheckRequired: false,
  },
  {
    tableName: 'public.tenant_memberships',
    policyName: 'tenant_memberships_announcement_author_select',
    command: 'SELECT',
    roles: ['public'],
    usingMarkers: [
      "current_setting('app.tenant_id'",
      "current_setting('app.announcement_id'",
      "current_setting('app.user_id'",
      'status =',
      'app_is_announcement_author',
    ],
    withCheckMarkers: [],
    usingRequired: true,
    withCheckRequired: false,
  },
  {
    tableName: 'public.members',
    policyName: 'members_select',
    command: 'SELECT',
    roles: ['public'],
    usingMarkers: [
      "current_setting('app.tenant_id'",
      "current_setting('app.user_id'",
      "current_setting('app.role'",
    ],
    withCheckMarkers: [],
    usingRequired: true,
    withCheckRequired: false,
  },
  {
    tableName: 'public.members',
    policyName: 'members_write',
    command: 'ALL',
    roles: ['public'],
    usingMarkers: [
      "current_setting('app.tenant_id'",
      "current_setting('app.role'",
    ],
    withCheckMarkers: [
      "current_setting('app.tenant_id'",
      "current_setting('app.role'",
    ],
    usingRequired: true,
    withCheckRequired: true,
  },
  {
    tableName: 'public.guardian_members',
    policyName: 'guardian_members_select',
    command: 'SELECT',
    roles: ['public'],
    usingMarkers: [
      "current_setting('app.tenant_id'",
      "current_setting('app.user_id'",
    ],
    withCheckMarkers: [],
    usingRequired: true,
    withCheckRequired: false,
  },
  {
    tableName: 'public.audit_logs',
    policyName: 'audit_logs_owner_select',
    command: 'SELECT',
    roles: ['public'],
    usingMarkers: [
      "current_setting('app.tenant_id'",
      "current_setting('app.role'",
    ],
    withCheckMarkers: [],
    usingRequired: true,
    withCheckRequired: false,
  },
  {
    tableName: 'public.audit_logs',
    policyName: 'audit_logs_insert',
    command: 'INSERT',
    roles: ['public'],
    usingMarkers: [],
    withCheckMarkers: [
      'app_has_active_membership',
      "current_setting('app.user_id'",
    ],
    usingRequired: false,
    withCheckRequired: true,
  },
  {
    tableName: 'public.promotion_runs',
    policyName: 'promotion_runs_admin_write',
    command: 'ALL',
    roles: ['public'],
    usingMarkers: [
      "current_setting('app.tenant_id'",
      "current_setting('app.role'",
    ],
    withCheckMarkers: [
      "current_setting('app.tenant_id'",
      "current_setting('app.role'",
    ],
    usingRequired: true,
    withCheckRequired: true,
  },
];

export function parseDatabaseTarget(
  value: string | undefined,
  label: string,
): DatabaseTarget {
  assert.ok(value, `${label}が必要です。`);
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`${label}はPostgreSQL URLで指定してください。`, {
      cause: error,
    });
  }
  assert.ok(
    url.protocol === 'postgresql:' || url.protocol === 'postgres:',
    `${label}はPostgreSQL URLで指定してください。`,
  );
  const database = decodeURIComponent(url.pathname.slice(1));
  assert.ok(database, `${label}にデータベース名がありません。`);
  assert.ok(url.hostname && url.username, `${label}のhost/roleが必要です。`);
  return {
    host: url.hostname.toLowerCase(),
    port: Number(url.port || 5432),
    database,
    user: decodeURIComponent(url.username),
    sslMode: url.searchParams.get('sslmode')?.toLowerCase() ?? null,
  };
}

function targetKey(target: DatabaseTarget): string {
  return `${target.host}:${target.port}/${target.database.toLowerCase()}`;
}

function csvValues(value: string | undefined, label: string): string[] {
  const values = (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  assert.ok(values.length > 0, `${label}が必要です。`);
  return values;
}

function assertAllowedTarget(
  target: DatabaseTarget,
  environment: string,
  label: string,
  allowedHosts: string | undefined,
  allowedDatabases: string | undefined,
  allowedTargets: string | undefined,
): void {
  assert.ok(
    environment === 'local' ||
      environment === 'staging' ||
      environment === 'production',
    'APP_ENVはlocal、staging、productionのいずれかにしてください。',
  );
  const hosts = csvValues(allowedHosts, 'DATABASE_ALLOWED_HOSTS');
  const databases = csvValues(allowedDatabases, 'DATABASE_ALLOWED_DATABASES');
  const targets = csvValues(allowedTargets, 'DATABASE_ALLOWED_TARGETS');
  assert.ok(
    hosts.includes(target.host),
    `${label}のhostが許可リストにありません。`,
  );
  assert.ok(
    databases.includes(target.database.toLowerCase()),
    `${label}のDB名が許可リストにありません。`,
  );
  assert.ok(
    targets.includes(targetKey(target)),
    `${label}のhost・port・DBが許可リストにありません。`,
  );
  if (environment !== 'local')
    assert.ok(
      target.sslMode &&
        ['require', 'verify-ca', 'verify-full'].includes(target.sslMode),
      `${label}のsslmodeはTLSを明示してください。`,
    );
}

export function assertDatabaseConnectionTargets(
  databaseUrl: string | undefined,
  directUrl: string | undefined,
  options: DatabaseSecurityOptions = {},
): void {
  const environment = options.environment ?? process.env.APP_ENV;
  assert.ok(environment, 'APP_ENVが必要です。');
  const app = parseDatabaseTarget(databaseUrl, 'DATABASE_URL');
  const admin = parseDatabaseTarget(directUrl, 'DIRECT_URL');
  const appRole =
    options.appRole ?? process.env.DATABASE_APP_ROLE ?? 'cocolo_app';
  const adminRole =
    options.adminRole ?? process.env.DATABASE_ADMIN_ROLE ?? admin.user;
  assert.equal(
    app.user,
    appRole,
    'DATABASE_URLはcocolo_app専用roleを使用してください。',
  );
  assert.equal(
    admin.user,
    adminRole,
    'DIRECT_URLのadmin roleが許可値と一致しません。',
  );
  assert.notEqual(
    app.user,
    admin.user,
    'DATABASE_URLとDIRECT_URLでroleを共有できません。',
  );
  assert.equal(
    app.host,
    admin.host,
    'DATABASE_URLとDIRECT_URLのhostが不一致です。',
  );
  assert.equal(
    app.port,
    admin.port,
    'DATABASE_URLとDIRECT_URLのportが不一致です。',
  );
  assert.equal(
    app.database,
    admin.database,
    'DATABASE_URLとDIRECT_URLのDBが不一致です。',
  );
  assertAllowedTarget(
    app,
    environment,
    'DATABASE_URL',
    options.allowedHosts ?? process.env.DATABASE_ALLOWED_HOSTS,
    options.allowedDatabases ?? process.env.DATABASE_ALLOWED_DATABASES,
    options.allowedTargets ?? process.env.DATABASE_ALLOWED_TARGETS,
  );
}

function aclKey(entry: DatabaseAclEntry): string {
  return `${entry.objectType}:${entry.objectName}:${entry.grantee}:${entry.privilege}`;
}

function ownerKey(entry: DatabaseObjectOwner): string {
  return `${entry.objectType}:${entry.objectName}`;
}

function membershipKey(entry: DatabaseMembership): string {
  return `${entry.roleName}:${entry.memberName}`;
}

function functionAclKey(entry: DatabaseFunctionAcl): string {
  return `${entry.grantee}:${entry.privilege}`;
}

function exactSet(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  const uniqueActual = [...new Set(actual)];
  assert.equal(
    uniqueActual.length,
    actual.length,
    `${label}に重複した検査行があります。`,
  );
  assert.deepEqual(
    [...uniqueActual].sort(),
    [...new Set(expected)].sort(),
    `${label}の許可集合が不一致です。`,
  );
}

function expectedObjectOwnerKeys(): string[] {
  return [
    'table:public._prisma_migrations',
    ...appTableNames.map((name) => `table:${name}`),
    ...appEnumNames.map((name) => `enum:${name}`),
  ];
}

function expectedAclEntries(
  objectOwners: readonly DatabaseObjectOwner[],
  appRole: string,
): DatabaseAclEntry[] {
  const entries: DatabaseAclEntry[] = [
    {
      objectType: 'schema',
      objectName: 'public',
      grantee: appRole,
      privilege: 'USAGE',
    },
    {
      objectType: 'schema',
      objectName: 'public',
      grantee: 'line_delivery_worker',
      privilege: 'USAGE',
    },
    {
      objectType: 'function',
      objectName: appGuardFunctionName,
      grantee: appRole,
      privilege: 'EXECUTE',
    },
  ];
  for (const objectName of appTableNames)
    for (const privilege of objectName === 'public.audit_logs'
      ? ['INSERT', 'SELECT']
      : ['INSERT', 'SELECT', 'UPDATE'])
      entries.push({
        objectType: 'table',
        objectName,
        grantee: appRole,
        privilege,
      });
  for (const objectName of new Set(
    objectOwners
      .filter((entry) => entry.objectType === 'sequence')
      .map((entry) => entry.objectName),
  ))
    for (const privilege of ['SELECT', 'USAGE'])
      entries.push({
        objectType: 'sequence',
        objectName,
        grantee: appRole,
        privilege,
      });
  for (const objectName of appEnumNames)
    entries.push({
      objectType: 'enum',
      objectName,
      grantee: appRole,
      privilege: 'USAGE',
    });
  return entries;
}

function normalizedExpression(value: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function assertPolicyExpression(
  expression: string | null,
  required: boolean,
  markers: readonly string[],
  label: string,
): void {
  const normalized = normalizedExpression(expression);
  if (!required) {
    assert.equal(normalized, '', `${label}は不要な式を持てません。`);
    return;
  }
  assert.ok(normalized, `${label}がありません。`);
  const withoutCurrentSettingFlags = normalized.replace(
    /current_setting\([^)]*\)/g,
    '',
  );
  assert.doesNotMatch(
    withoutCurrentSettingFlags,
    /\btrue\b/,
    `${label}に無条件のtrueを指定できません。`,
  );
  for (const marker of markers)
    assert.match(
      normalized,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `${label}に境界 ${marker} がありません。`,
    );
}

export function assertDatabaseSecurity(
  inspection: DatabaseSecurityInspection,
  options: DatabaseSecurityOptions = {},
): void {
  const appRole =
    options.appRole ?? process.env.DATABASE_APP_ROLE ?? 'cocolo_app';
  const adminRole =
    options.adminRole ??
    process.env.DATABASE_ADMIN_ROLE ??
    inspection.adminIdentity.currentUser;
  assert.equal(
    inspection.appIdentity.currentUser,
    appRole,
    'DATABASE_URLの実接続roleが不一致です。',
  );
  assert.equal(
    inspection.adminIdentity.currentUser,
    adminRole,
    'DIRECT_URLの実接続admin roleが不一致です。',
  );
  assert.notEqual(appRole, adminRole, 'app roleとadmin roleを共有できません。');
  assert.equal(
    inspection.appIdentity.currentDatabase,
    inspection.adminIdentity.currentDatabase,
    'app/admin接続のDBが不一致です。',
  );
  assert.equal(
    inspection.appIdentity.serverPort,
    inspection.adminIdentity.serverPort,
    'app/admin接続のserver portが不一致です。',
  );
  assert.equal(
    inspection.appRole.roleName,
    appRole,
    'cocolo_app roleが見つかりません。',
  );
  assert.equal(
    inspection.appRole.isSuperuser,
    false,
    'cocolo_appにsuperuser権限があります。',
  );
  assert.equal(
    inspection.appRole.bypassRls,
    false,
    'cocolo_appにbypassrls権限があります。',
  );
  assert.equal(
    inspection.appRole.canCreateDatabase,
    false,
    'cocolo_appにcreatedb権限があります。',
  );
  assert.equal(
    inspection.appRole.canCreateRole,
    false,
    'cocolo_appにcreaterole権限があります。',
  );
  assert.equal(
    inspection.appRole.canReplicate,
    false,
    'cocolo_appにreplication権限があります。',
  );
  assert.equal(
    inspection.appRole.canLogin,
    true,
    'cocolo_appにLOGIN属性がありません。',
  );
  assert.equal(
    inspection.appRole.hasMembership,
    false,
    'cocolo_appにrole membershipがあります。',
  );
  assert.equal(
    inspection.databaseOwner,
    adminRole,
    '実DB ownerがDIRECT_URLのadmin roleではありません。',
  );
  assert.ok(
    [adminRole, 'pg_database_owner'].includes(inspection.schemaOwner),
    'public schema ownerが許可集合にありません。',
  );
  exactSet(
    inspection.schemaOwners.map((entry) => entry.schemaName),
    ['public'],
    '実DB schema名',
  );
  assert.ok(
    inspection.schemaOwners.every((entry) =>
      [adminRole, 'pg_database_owner'].includes(entry.owner),
    ),
    '実DB schema ownerが許可集合にありません。',
  );

  exactSet(
    inspection.objectOwners.map(ownerKey),
    expectedObjectOwnerKeys(),
    '実DB objectの種類・名前',
  );
  assert.ok(
    inspection.objectOwners.every((entry) => entry.owner === adminRole),
    'table/sequence/enumのownerがadmin role以外です。',
  );
  exactSet(
    inspection.memberships.map(membershipKey),
    allowedMembershipKeys,
    '実DB pg_auth_members',
  );
  exactSet(
    inspection.defaultAclEntries.map(aclKey),
    [],
    '実DB default privileges',
  );
  const expectedAcls = expectedAclEntries(inspection.objectOwners, appRole);
  exactSet(
    inspection.aclEntries.map(aclKey),
    expectedAcls.map(aclKey),
    '実DB schema/table/sequence/enum/function ACL',
  );
  assert.ok(
    inspection.aclEntries.every((entry) => entry.grantee !== 'PUBLIC'),
    '実DBのPUBLIC grantを拒否します。',
  );

  exactSet(
    inspection.rls.map((entry) => entry.tableName),
    [...appTableNames],
    '実DB RLS対象table',
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

  const expectedPolicyKeys = expectedPolicies.map(
    (policy) => `${policy.tableName}:${policy.policyName}`,
  );
  exactSet(
    inspection.policies.map(
      (policy) => `${policy.tableName}:${policy.policyName}`,
    ),
    expectedPolicyKeys,
    '実DB RLS policy名',
  );
  for (const expected of expectedPolicies) {
    const actual = inspection.policies.find(
      (policy) =>
        policy.tableName === expected.tableName &&
        policy.policyName === expected.policyName,
    );
    assert.ok(actual, `${expected.policyName}: RLS policyがありません。`);
    assert.equal(
      actual.permissive,
      'PERMISSIVE',
      `${expected.policyName}: RESTRICTIVE policyは許可しません。`,
    );
    exactSet(
      actual.roles,
      expected.roles,
      `${expected.policyName}: policy role`,
    );
    assert.equal(
      actual.command,
      expected.command,
      `${expected.policyName}: commandが不一致です。`,
    );
    assertPolicyExpression(
      actual.usingExpression,
      expected.usingRequired,
      expected.usingMarkers,
      `${expected.policyName}: USING`,
    );
    assertPolicyExpression(
      actual.withCheckExpression,
      expected.withCheckRequired,
      expected.withCheckMarkers,
      `${expected.policyName}: WITH CHECK`,
    );
  }

  exactSet(
    inspection.functions.map((fn) => fn.functionName),
    [appGuardFunctionName],
    'public function',
  );
  const guard = inspection.functions.find(
    (fn) => fn.functionName === appGuardFunctionName,
  );
  assert.ok(guard, 'app_guard functionがありません。');
  assert.equal(
    guard.owner,
    adminRole,
    'app_guard functionのownerがadmin role以外です。',
  );
  assert.equal(
    guard.securityDefiner,
    false,
    '許可されていないSECURITY DEFINER functionです。',
  );
  assert.equal(
    normalizedExpression(guard.searchPathConfig),
    'search_path=pg_catalog, public',
    'app_guard functionのsearch_pathが固定されていません。',
  );
  exactSet(
    guard.aclEntries.map(functionAclKey),
    [`${appRole}:EXECUTE`],
    'app_guard function ACL',
  );
  assert.ok(
    guard.aclEntries.every((entry) => entry.grantee !== 'PUBLIC'),
    'app_guard functionへのEXECUTE PUBLICを拒否します。',
  );
}

async function readIdentity(
  client: PrismaClientLike,
): Promise<DatabaseIdentity> {
  const rows = await client.$queryRawUnsafe<readonly [DatabaseIdentity]>(
    `SELECT current_user AS "currentUser",
            current_database() AS "currentDatabase",
            inet_server_addr()::text AS "serverAddress",
            inet_server_port()::int AS "serverPort"`,
  );
  assert.equal(rows.length, 1, 'PostgreSQL接続identityを取得できません。');
  return rows[0] as DatabaseIdentity;
}

export async function inspectDatabaseSecurity(
  databaseUrl: string | undefined,
  directUrl: string | undefined,
  appRole = process.env.DATABASE_APP_ROLE ?? 'cocolo_app',
): Promise<DatabaseSecurityInspection> {
  assert.ok(databaseUrl, 'DATABASE_URLが必要です。');
  assert.ok(directUrl, 'DIRECT_URLが必要です。');
  const appIdentity = await withPostgresClient(databaseUrl, readIdentity);
  return withPostgresClient(directUrl, async (admin) => {
    const [
      adminIdentity,
      roleRows,
      databaseRows,
      schemaRows,
      schemaOwners,
      objectOwners,
      aclEntries,
      defaultAclEntries,
      memberships,
      rls,
      policies,
      functions,
    ] = await Promise.all([
      readIdentity(admin),
      admin.$queryRawUnsafe<DatabaseRoleInspection[]>(
        `SELECT r.rolname AS "roleName",
                r.rolsuper AS "isSuperuser",
                r.rolbypassrls AS "bypassRls",
                r.rolcreatedb AS "canCreateDatabase",
                r.rolcreaterole AS "canCreateRole",
                r.rolreplication AS "canReplicate",
                r.rolcanlogin AS "canLogin",
                EXISTS (
                  SELECT 1
                    FROM pg_auth_members m
                   WHERE m.member = r.oid OR m.roleid = r.oid
                ) AS "hasMembership"
           FROM pg_roles r
          WHERE r.rolname = $1`,
        appRole,
      ),
      admin.$queryRawUnsafe<readonly [{ databaseOwner: string }]>(
        `SELECT pg_get_userbyid(datdba) AS "databaseOwner"
           FROM pg_database
          WHERE datname = current_database()`,
      ),
      admin.$queryRawUnsafe<readonly [{ schemaOwner: string }]>(
        `SELECT pg_get_userbyid(nspowner) AS "schemaOwner"
           FROM pg_namespace
          WHERE nspname = 'public'`,
      ),
      admin.$queryRawUnsafe<DatabaseSchemaOwner[]>(
        `SELECT nspname AS "schemaName",
                pg_get_userbyid(nspowner) AS owner
           FROM pg_namespace
          WHERE nspname NOT IN ('pg_catalog', 'information_schema')
            AND nspname NOT LIKE 'pg_toast%'`,
      ),
      admin.$queryRawUnsafe<DatabaseObjectOwner[]>(
        `SELECT 'table'::text AS "objectType",
                n.nspname || '.' || c.relname AS "objectName",
                pg_get_userbyid(c.relowner) AS owner
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND (c.relname = '_prisma_migrations' OR c.relname = ANY($1::text[]))
            AND c.relkind IN ('r', 'v', 'm', 'f', 'p')
          UNION ALL
         SELECT 'sequence'::text, n.nspname || '.' || c.relname,
                pg_get_userbyid(c.relowner)
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname = ANY($1::text[])
            AND c.relkind = 'S'
          UNION ALL
         SELECT 'enum'::text, n.nspname || '.' || t.typname,
                pg_get_userbyid(t.typowner)
           FROM pg_type t
           JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public'
            AND t.typname = ANY($2::text[])
            AND t.typtype = 'e'`,
        appTableNameValues,
        appEnumNameValues,
      ),
      admin.$queryRawUnsafe<DatabaseAclEntry[]>(
        `SELECT 'schema'::text AS "objectType",
                n.nspname AS "objectName",
                CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee,
                x.privilege_type AS privilege
           FROM pg_namespace n
           CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) x
          WHERE n.nspname = 'public'
            AND x.grantee <> n.nspowner
          UNION ALL
         SELECT CASE WHEN c.relkind = 'S' THEN 'sequence'::text ELSE 'table'::text END,
                n.nspname || '.' || c.relname,
                CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
                x.privilege_type
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           CROSS JOIN LATERAL aclexplode(
             COALESCE(
               c.relacl,
               acldefault(CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END, c.relowner)
             )
           ) x
          WHERE n.nspname = 'public'
            AND c.relname = ANY($1::text[])
            AND c.relkind IN ('r', 'v', 'm', 'f', 'p', 'S')
            AND x.grantee <> c.relowner
          UNION ALL
         SELECT 'enum'::text, n.nspname || '.' || t.typname,
                CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
                x.privilege_type
           FROM pg_type t
           JOIN pg_namespace n ON n.oid = t.typnamespace
           CROSS JOIN LATERAL aclexplode(COALESCE(t.typacl, acldefault('T', t.typowner))) x
          WHERE n.nspname = 'public'
            AND t.typname = ANY($2::text[])
            AND t.typtype = 'e'
            AND x.grantee <> t.typowner
          UNION ALL
         SELECT 'function'::text,
                n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
                CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
                x.privilege_type
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
          WHERE n.nspname = 'public'
            AND p.proname = 'app_guard_promotion_run_transition'
            AND p.prokind IN ('f', 'p')
            AND x.grantee <> p.proowner`,
        appTableNameValues,
        appEnumNameValues,
      ),
      admin.$queryRawUnsafe<DatabaseAclEntry[]>(
        `SELECT 'default'::text AS "objectType",
                COALESCE(n.nspname, '*') AS "objectName",
                CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee,
                x.privilege_type AS privilege
           FROM pg_default_acl d
           LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
           CROSS JOIN LATERAL aclexplode(d.defaclacl) x`,
      ),
      admin.$queryRawUnsafe<DatabaseMembership[]>(
        `SELECT pg_get_userbyid(roleid) AS "roleName",
                pg_get_userbyid(member) AS "memberName"
           FROM pg_auth_members`,
      ),
      admin.$queryRawUnsafe<DatabaseRlsInspection[]>(
        `SELECT n.nspname || '.' || c.relname AS "tableName",
                c.relrowsecurity AS enabled,
                c.relforcerowsecurity AS forced
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind = 'r'
            AND c.relname = ANY($1::text[])
            ORDER BY c.relname`,
        appTableNameValues,
      ),
      admin.$queryRawUnsafe<DatabasePolicyInspection[]>(
        `SELECT schemaname || '.' || tablename AS "tableName",
                policyname AS "policyName",
                permissive,
                roles::text[] AS roles,
                cmd AS "command",
                qual AS "usingExpression",
                with_check AS "withCheckExpression"
           FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = ANY($1::text[])
          ORDER BY tablename, policyname`,
        appTableNames.map((name) => name.slice('public.'.length)),
      ),
      admin
        .$queryRawUnsafe<DatabaseFunctionInspection[]>(
          `SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS "functionName",
                pg_get_userbyid(p.proowner) AS owner,
                p.prosecdef AS "securityDefiner",
                (
                  SELECT value
                    FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS config(value)
                   WHERE value LIKE 'search_path=%'
                   LIMIT 1
                ) AS "searchPathConfig",
                COALESCE(
                  (
                    SELECT jsonb_agg(
                      jsonb_build_object(
                        'grantee', CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
                        'privilege', x.privilege_type
                      )
                    )
                      FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                     WHERE x.grantee <> p.proowner
                  ),
                  '[]'::jsonb
                ) AS "aclEntries"
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname = 'app_guard_promotion_run_transition'
            AND p.prokind IN ('f', 'p')`,
        )
        .then((rows) =>
          rows.map((row) => ({
            ...row,
            aclEntries: (row.aclEntries ??
              []) as readonly DatabaseFunctionAcl[],
          })),
        ),
    ]);
    assert.equal(roleRows.length, 1, 'cocolo_app roleが見つかりません。');
    assert.equal(databaseRows.length, 1, '実DBのownerを取得できません。');
    assert.equal(
      schemaRows.length,
      1,
      'public schemaのownerを取得できません。',
    );
    return {
      appIdentity,
      adminIdentity,
      appRole: roleRows[0] as DatabaseRoleInspection,
      databaseOwner: databaseRows[0]?.databaseOwner ?? '',
      schemaOwner: schemaRows[0]?.schemaOwner ?? '',
      schemaOwners,
      objectOwners,
      aclEntries,
      defaultAclEntries,
      memberships,
      rls,
      policies,
      functions,
    };
  });
}

export async function verifyDatabaseSecurity(
  databaseUrl = process.env.DATABASE_URL,
  directUrl = process.env.DIRECT_URL,
  options: DatabaseSecurityOptions = {},
): Promise<void> {
  assertDatabaseConnectionTargets(databaseUrl, directUrl, options);
  const appTarget = parseDatabaseTarget(databaseUrl, 'DATABASE_URL');
  const adminTarget = parseDatabaseTarget(directUrl, 'DIRECT_URL');
  const inspection = await inspectDatabaseSecurity(
    databaseUrl,
    directUrl,
    options.appRole ?? process.env.DATABASE_APP_ROLE ?? 'cocolo_app',
  );
  assert.equal(
    inspection.appIdentity.currentDatabase,
    appTarget.database,
    'DATABASE_URLの実DB名がURLと一致しません。',
  );
  assert.equal(
    inspection.adminIdentity.currentDatabase,
    adminTarget.database,
    'DIRECT_URLの実DB名がURLと一致しません。',
  );
  // URLのportはNAT/port mapping後の公開portになり得るため、実接続同士のserver portだけを一致照合する。
  assertDatabaseSecurity(inspection, options);
}
