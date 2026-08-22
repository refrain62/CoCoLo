import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const REQUIRED_TABLE_PRIVILEGES = {
  tenants: ['SELECT'],
  tenant_memberships: ['SELECT'],
  members: ['SELECT', 'INSERT', 'UPDATE'],
  guardian_members: ['SELECT'],
  audit_logs: ['SELECT', 'INSERT'],
  promotion_runs: ['SELECT', 'INSERT', 'UPDATE'],
} as const;

const TABLE_PRIVILEGE_NAMES = [
  'select',
  'insert',
  'update',
  'delete',
  'truncate',
  'references',
  'trigger',
] as const;

type TablePrivilegeName = (typeof TABLE_PRIVILEGE_NAMES)[number];

type RequiredPolicy = Readonly<{
  table: keyof typeof REQUIRED_TABLE_PRIVILEGES;
  name: string;
  command: 'SELECT' | 'INSERT' | 'ALL';
  usingTokens?: readonly string[];
  withCheckTokens?: readonly string[];
}>;

const REQUIRED_POLICIES: readonly RequiredPolicy[] = [
  {
    table: 'tenants',
    name: 'tenants_select',
    command: 'SELECT',
    usingTokens: ['id', 'current_setting', 'app.tenant_id'],
  },
  {
    table: 'tenant_memberships',
    name: 'tenant_memberships_select',
    command: 'SELECT',
    usingTokens: ['tenant_id', 'user_id', 'current_setting', 'app.user_id'],
  },
  {
    table: 'members',
    name: 'members_select',
    command: 'SELECT',
    usingTokens: [
      'current_setting',
      'app.tenant_id',
      'app.role',
      'tenant_id',
      'guardian_members',
    ],
  },
  {
    table: 'members',
    name: 'members_write',
    command: 'ALL',
    usingTokens: [
      'current_setting',
      'app.tenant_id',
      'app.role',
      'tenant_id',
      'owner',
      'admin',
    ],
    withCheckTokens: [
      'current_setting',
      'app.tenant_id',
      'app.role',
      'tenant_id',
      'owner',
      'admin',
    ],
  },
  {
    table: 'guardian_members',
    name: 'guardian_members_select',
    command: 'SELECT',
    usingTokens: [
      'current_setting',
      'app.tenant_id',
      'app.user_id',
      'tenant_id',
      'user_id',
    ],
  },
  {
    table: 'audit_logs',
    name: 'audit_logs_owner_select',
    command: 'SELECT',
    usingTokens: [
      'current_setting',
      'app.tenant_id',
      'app.role',
      'tenant_id',
      'owner',
    ],
  },
  {
    table: 'audit_logs',
    name: 'audit_logs_insert',
    command: 'INSERT',
    withCheckTokens: [
      'current_setting',
      'app.tenant_id',
      'app.user_id',
      'tenant_id',
      'actor_user_id',
    ],
  },
  {
    table: 'promotion_runs',
    name: 'promotion_runs_admin_write',
    command: 'ALL',
    usingTokens: [
      'current_setting',
      'app.tenant_id',
      'app.role',
      'tenant_id',
      'owner',
      'admin',
    ],
    withCheckTokens: [
      'current_setting',
      'app.tenant_id',
      'app.role',
      'tenant_id',
      'owner',
      'admin',
    ],
  },
];

export type DatabaseSecurityInspection = Readonly<{
  connection: Readonly<{
    currentUser: string;
    sessionUser: string;
    database: string;
    serverVersion: string;
    serverVersionNum: string;
  }>;
  appRole: Readonly<{
    rolname: string;
    rolcanlogin: boolean;
    rolsuper: boolean;
    rolinherit: boolean;
    rolcreaterole: boolean;
    rolcreatedb: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
  }> | null;
  memberships: readonly Readonly<{
    role: string;
    adminOption: boolean;
  }>[];
  ownedSchemas: readonly string[];
  ownedObjects: readonly Readonly<{
    kind: string;
    name: string;
  }>[];
  schemaPrivileges: readonly Readonly<{
    schema: string;
    usage: boolean;
    create: boolean;
  }>[];
  tablePrivileges: readonly Readonly<
    {
      schema: string;
      table: string;
    } & Record<TablePrivilegeName, boolean>
  >[];
  rlsTables: readonly Readonly<{
    schema: string;
    table: string;
    hasTenantId: boolean;
    enabled: boolean;
    forced: boolean;
  }>[];
  policies: readonly Readonly<{
    schema: string;
    table: string;
    name: string;
    permissive: string;
    roles: readonly string[];
    command: string;
    usingExpression: string | null;
    withCheckExpression: string | null;
  }>[];
}>;

export type PsqlExecutionResult = Readonly<{
  status: number | null;
  stdout: string;
  error?: Error;
}>;

export type PsqlRunner = (databaseUrl: string) => PsqlExecutionResult;

// pg_catalogだけを問い合わせ、接続ユーザー・role・権限・RLS・policyを1回の実DB検査へ固定する。
export const DATABASE_SECURITY_QUERY = `
SELECT json_build_object(
  'connection', json_build_object(
    'currentUser', current_user,
    'sessionUser', session_user,
    'database', current_database(),
    'serverVersion', version(),
    'serverVersionNum', current_setting('server_version_num', true)
  ),
  'appRole', (
    SELECT json_build_object(
      'rolname', rolname,
      'rolcanlogin', rolcanlogin,
      'rolsuper', rolsuper,
      'rolinherit', rolinherit,
      'rolcreaterole', rolcreaterole,
      'rolcreatedb', rolcreatedb,
      'rolreplication', rolreplication,
      'rolbypassrls', rolbypassrls
    )
    FROM pg_roles
    WHERE rolname = 'cocolo_app'
  ),
  'memberships', COALESCE((
    SELECT json_agg(
      json_build_object(
        'role', parent.rolname,
        'adminOption', membership.admin_option
      )
      ORDER BY parent.rolname
    )
    FROM pg_auth_members membership
    JOIN pg_roles parent ON parent.oid = membership.roleid
    JOIN pg_roles member ON member.oid = membership.member
    WHERE member.rolname = 'cocolo_app'
  ), '[]'::json),
  'ownedSchemas', COALESCE((
    SELECT json_agg(n.nspname ORDER BY n.nspname)
    FROM pg_namespace n
    WHERE n.nspowner = (
      SELECT oid FROM pg_roles WHERE rolname = 'cocolo_app'
    )
  ), '[]'::json),
  'ownedObjects', COALESCE((
    SELECT json_agg(
      json_build_object('kind', owned.kind, 'name', owned.name)
      ORDER BY owned.kind, owned.name
    )
    FROM (
      SELECT 'schema'::text AS kind, n.nspname AS name
      FROM pg_namespace n
      WHERE n.nspowner = (
        SELECT oid FROM pg_roles WHERE rolname = 'cocolo_app'
      )
        AND n.nspname NOT LIKE 'pg_%'
        AND n.nspname <> 'information_schema'
      UNION ALL
      SELECT
        CASE c.relkind
          WHEN 'S' THEN 'sequence'
          ELSE 'relation'
        END,
        format('%I.%I', n.nspname, c.relname)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relowner = (
        SELECT oid FROM pg_roles WHERE rolname = 'cocolo_app'
      )
        AND n.nspname NOT LIKE 'pg_%'
        AND n.nspname <> 'information_schema'
      UNION ALL
      SELECT
        'function',
        format(
          '%I.%I(%s)',
          n.nspname,
          p.proname,
          pg_get_function_identity_arguments(p.oid)
        )
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proowner = (
        SELECT oid FROM pg_roles WHERE rolname = 'cocolo_app'
      )
        AND n.nspname NOT LIKE 'pg_%'
        AND n.nspname <> 'information_schema'
      UNION ALL
      SELECT 'type', format('%I.%I', n.nspname, t.typname)
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typowner = (
        SELECT oid FROM pg_roles WHERE rolname = 'cocolo_app'
      )
        AND n.nspname NOT LIKE 'pg_%'
        AND n.nspname <> 'information_schema'
        AND t.typtype IN ('b', 'c', 'd', 'e', 'r')
    ) owned
  ), '[]'::json),
  'schemaPrivileges', COALESCE((
    SELECT json_agg(
      json_build_object(
        'schema', n.nspname,
        'usage', has_schema_privilege('cocolo_app', n.oid, 'USAGE'),
        'create', has_schema_privilege('cocolo_app', n.oid, 'CREATE')
      )
      ORDER BY n.nspname
    )
    FROM pg_namespace n
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
  ), '[]'::json),
  'tablePrivileges', COALESCE((
    SELECT json_agg(
      json_build_object(
        'schema', n.nspname,
        'table', c.relname,
        'select', has_table_privilege('cocolo_app', c.oid, 'SELECT'),
        'insert', has_table_privilege('cocolo_app', c.oid, 'INSERT'),
        'update', has_table_privilege('cocolo_app', c.oid, 'UPDATE'),
        'delete', has_table_privilege('cocolo_app', c.oid, 'DELETE'),
        'truncate', has_table_privilege('cocolo_app', c.oid, 'TRUNCATE'),
        'references', has_table_privilege('cocolo_app', c.oid, 'REFERENCES'),
        'trigger', has_table_privilege('cocolo_app', c.oid, 'TRIGGER')
      )
      ORDER BY n.nspname, c.relname
    )
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname = 'public'
  ), '[]'::json),
  'rlsTables', COALESCE((
    SELECT json_agg(
      json_build_object(
        'schema', n.nspname,
        'table', c.relname,
        'hasTenantId', EXISTS (
          SELECT 1
          FROM pg_attribute attribute
          WHERE attribute.attrelid = c.oid
            AND attribute.attname = 'tenant_id'
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
        ),
        'enabled', c.relrowsecurity,
        'forced', c.relforcerowsecurity
      )
      ORDER BY n.nspname, c.relname
    )
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname = 'public'
  ), '[]'::json),
  'policies', COALESCE((
    SELECT json_agg(
      json_build_object(
        'schema', policies.schemaname,
        'table', policies.tablename,
        'name', policies.policyname,
        'permissive', policies.permissive,
        'roles', policies.roles,
        'command', policies.cmd,
        'usingExpression', policies.qual,
        'withCheckExpression', policies.with_check
      )
      ORDER BY policies.schemaname, policies.tablename, policies.policyname
    )
    FROM pg_policies policies
    WHERE policies.schemaname = 'public'
  ), '[]'::json)
)::text;
`;

function assertRecord(
  value: unknown,
  message: string,
): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    message,
  );
  return value as Record<string, unknown>;
}

function assertString(
  value: unknown,
  message: string,
): asserts value is string {
  assert.equal(typeof value, 'string', message);
}

function assertBoolean(
  value: unknown,
  message: string,
): asserts value is boolean {
  assert.equal(typeof value, 'boolean', message);
}

function assertStringArray(
  value: unknown,
  message: string,
): asserts value is readonly string[] {
  assert.ok(
    Array.isArray(value) && value.every((item) => typeof item === 'string'),
    message,
  );
}

function parseDatabaseUrl(databaseUrl: string | undefined) {
  if (typeof databaseUrl !== 'string' || databaseUrl.trim() === '')
    throw new Error('DATABASE_URL が必要です。');
  const normalized = databaseUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('DATABASE_URL の形式が不正です。');
  }
  assert.ok(
    parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:',
    'DATABASE_URL はPostgreSQL URLである必要があります。',
  );
  assert.ok(parsed.hostname, 'DATABASE_URL にホスト名が必要です。');
  return normalized;
}

function runPsqlQuery(databaseUrl: string): PsqlExecutionResult {
  const result = spawnSync(
    process.platform === 'win32' ? 'psql.exe' : 'psql',
    [
      '--no-psqlrc',
      '--no-password',
      '--tuples-only',
      '--no-align',
      '--quiet',
      '--set',
      'ON_ERROR_STOP=1',
      '--dbname',
      databaseUrl,
      '--command',
      DATABASE_SECURITY_QUERY,
    ],
    {
      encoding: 'utf8',
    },
  );
  return {
    status: result.status,
    stdout: String(result.stdout ?? ''),
    error: result.error,
  };
}

function parseInspection(stdout: string): DatabaseSecurityInspection {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new Error('PostgreSQL検査結果のJSONを解釈できません。');
  }
  return parsed as DatabaseSecurityInspection;
}

function assertConnection(inspection: DatabaseSecurityInspection) {
  const connection = assertRecord(
    inspection.connection,
    '接続検査結果がありません。',
  );
  assertString(connection.currentUser, 'current_userがありません。');
  assertString(connection.sessionUser, 'session_userがありません。');
  assertString(connection.database, 'current_databaseがありません。');
  assertString(connection.serverVersion, 'PostgreSQL versionがありません。');
  assertString(
    connection.serverVersionNum,
    'PostgreSQL server_version_numがありません。',
  );
  assert.equal(
    connection.currentUser,
    'cocolo_app',
    'DATABASE_URLのcurrent_userはcocolo_appである必要があります。',
  );
  assert.equal(
    connection.sessionUser,
    'cocolo_app',
    'DATABASE_URLのsession_userはcocolo_appである必要があります。',
  );
  assert.match(
    connection.serverVersion,
    /^PostgreSQL\s/i,
    '接続先はPostgreSQLである必要があります。',
  );
  assert.match(
    connection.serverVersionNum,
    /^\d+$/,
    'PostgreSQL server_version_numが不正です。',
  );
}

function assertRole(inspection: DatabaseSecurityInspection) {
  const role = assertRecord(
    inspection.appRole,
    'cocolo_app roleがありません。',
  );
  for (const key of [
    'rolcanlogin',
    'rolsuper',
    'rolinherit',
    'rolcreaterole',
    'rolcreatedb',
    'rolreplication',
    'rolbypassrls',
  ])
    assertBoolean(role[key], `cocolo_app.${key}が不正です。`);
  assert.equal(role.rolname, 'cocolo_app', 'cocolo_app role名が不正です。');
  assert.equal(
    role.rolcanlogin,
    true,
    'cocolo_appはLOGIN roleである必要があります。',
  );
  assert.equal(
    role.rolsuper,
    false,
    'cocolo_appにSUPERUSERを与えてはいけません。',
  );
  assert.equal(
    role.rolcreaterole,
    false,
    'cocolo_appにCREATEROLEを与えてはいけません。',
  );
  assert.equal(
    role.rolcreatedb,
    false,
    'cocolo_appにCREATEDBを与えてはいけません。',
  );
  assert.equal(
    role.rolreplication,
    false,
    'cocolo_appにREPLICATIONを与えてはいけません。',
  );
  assert.equal(
    role.rolbypassrls,
    false,
    'cocolo_appにBYPASSRLSを与えてはいけません。',
  );
}

function assertNoMemberships(inspection: DatabaseSecurityInspection) {
  assert.ok(
    Array.isArray(inspection.memberships),
    'cocolo_app role membershipの検査結果が不正です。',
  );
  assert.equal(
    inspection.memberships.length,
    0,
    'cocolo_appに不要なrole membershipがあります。',
  );
}

function assertNoOwnership(inspection: DatabaseSecurityInspection) {
  assert.ok(
    Array.isArray(inspection.ownedSchemas),
    'cocolo_app schema ownerの検査結果が不正です。',
  );
  assert.ok(
    Array.isArray(inspection.ownedObjects),
    'cocolo_app object ownerの検査結果が不正です。',
  );
  assert.equal(
    inspection.ownedSchemas.length,
    0,
    'cocolo_appをschema ownerにしてはいけません。',
  );
  assert.equal(
    inspection.ownedObjects.length,
    0,
    'cocolo_appをschema/table/function/type ownerにしてはいけません。',
  );
}

function assertSchemaPrivileges(inspection: DatabaseSecurityInspection) {
  assert.ok(
    Array.isArray(inspection.schemaPrivileges),
    'schema権限の検査結果が不正です。',
  );
  const seen = new Set<string>();
  let publicSchemaFound = false;
  for (const schema of inspection.schemaPrivileges) {
    const record = assertRecord(schema, 'schema権限の行が不正です。');
    assertString(record.schema, 'schema名がありません。');
    assertBoolean(record.usage, `${record.schema}: USAGE権限が不正です。`);
    assertBoolean(record.create, `${record.schema}: CREATE権限が不正です。`);
    assert.ok(
      !seen.has(record.schema),
      `${record.schema}: schema権限が重複しています。`,
    );
    seen.add(record.schema);
    if (record.schema === 'public') {
      publicSchemaFound = true;
      assert.equal(record.usage, true, 'public schemaのUSAGE権限が必要です。');
      assert.equal(
        record.create,
        false,
        'cocolo_appにpublic schemaのCREATEを与えてはいけません。',
      );
    } else {
      assert.equal(
        record.usage,
        false,
        `${record.schema} schemaのUSAGEを与えてはいけません。`,
      );
      assert.equal(
        record.create,
        false,
        `${record.schema} schemaのCREATEを与えてはいけません。`,
      );
    }
  }
  assert.equal(
    publicSchemaFound,
    true,
    'public schemaの権限検査結果がありません。',
  );
}

function assertTablePrivileges(inspection: DatabaseSecurityInspection) {
  assert.ok(
    Array.isArray(inspection.tablePrivileges),
    'table権限の検査結果が不正です。',
  );
  const seen = new Set<string>();
  const requiredTables = new Set(Object.keys(REQUIRED_TABLE_PRIVILEGES));
  for (const table of inspection.tablePrivileges) {
    const record = assertRecord(table, 'table権限の行が不正です。');
    assertString(record.schema, 'table schema名がありません。');
    assertString(record.table, 'table名がありません。');
    const key = `${record.schema}.${record.table}`;
    assert.ok(!seen.has(key), `${key}: table権限が重複しています。`);
    seen.add(key);
    for (const privilege of TABLE_PRIVILEGE_NAMES)
      assertBoolean(record[privilege], `${key}: ${privilege}権限が不正です。`);
    if (record.schema !== 'public') {
      assert.ok(
        TABLE_PRIVILEGE_NAMES.every((privilege) => record[privilege] === false),
        `${key}: public以外のtable権限を与えてはいけません。`,
      );
      continue;
    }
    const required =
      REQUIRED_TABLE_PRIVILEGES[
        record.table as keyof typeof REQUIRED_TABLE_PRIVILEGES
      ];
    if (!required) {
      assert.ok(
        TABLE_PRIVILEGE_NAMES.every((privilege) => record[privilege] === false),
        `${key}: allowlist外のtable権限を与えてはいけません。`,
      );
      continue;
    }
    const requiredSet = new Set(
      required.map((privilege) => privilege.toLowerCase()),
    );
    for (const privilege of TABLE_PRIVILEGE_NAMES)
      assert.equal(
        record[privilege],
        requiredSet.has(privilege),
        `${key}: ${privilege.toUpperCase()}権限がallowlistと一致しません。`,
      );
    requiredTables.delete(record.table);
  }
  assert.deepEqual(
    [...requiredTables].sort(),
    [],
    '必須tableの権限検査結果が不足しています。',
  );
}

function assertRls(inspection: DatabaseSecurityInspection) {
  assert.ok(Array.isArray(inspection.rlsTables), 'RLS検査結果が不正です。');
  const seen = new Set<string>();
  const requiredTables = new Set(Object.keys(REQUIRED_TABLE_PRIVILEGES));
  for (const table of inspection.rlsTables) {
    const record = assertRecord(table, 'RLS検査の行が不正です。');
    assertString(record.schema, 'RLS schema名がありません。');
    assertString(record.table, 'RLS table名がありません。');
    assertBoolean(
      record.hasTenantId,
      `${record.schema}.${record.table}: tenant_id情報が不正です。`,
    );
    assertBoolean(
      record.enabled,
      `${record.schema}.${record.table}: RLS ENABLE情報が不正です。`,
    );
    assertBoolean(
      record.forced,
      `${record.schema}.${record.table}: RLS FORCE情報が不正です。`,
    );
    const key = `${record.schema}.${record.table}`;
    assert.ok(!seen.has(key), `${key}: RLS検査結果が重複しています。`);
    seen.add(key);
    if (
      record.schema === 'public' &&
      (record.hasTenantId || requiredTables.has(record.table))
    ) {
      assert.equal(record.enabled, true, `${key}: RLS ENABLEが必要です。`);
      assert.equal(record.forced, true, `${key}: RLS FORCEが必要です。`);
    }
    if (record.schema === 'public' && requiredTables.has(record.table))
      requiredTables.delete(record.table);
  }
  assert.deepEqual(
    [...requiredTables].sort(),
    [],
    '必須tableのRLS検査結果が不足しています。',
  );
}

function assertExpression(
  expression: unknown,
  tokens: readonly string[],
  message: string,
) {
  assertString(expression, `${message}: policy expressionがありません。`);
  const normalized = expression.toLowerCase();
  assert.notEqual(
    normalized.trim(),
    'true',
    `${message}: 常にtrueのpolicyは許可しません。`,
  );
  for (const token of tokens)
    assert.ok(
      normalized.includes(token.toLowerCase()),
      `${message}: ${token}の境界条件がありません。`,
    );
}

function assertPolicies(inspection: DatabaseSecurityInspection) {
  assert.ok(Array.isArray(inspection.policies), 'policy検査結果が不正です。');
  const seen = new Set<string>();
  const requiredKeys = new Set(
    REQUIRED_POLICIES.map((policy) => `public.${policy.table}.${policy.name}`),
  );
  const requiredTableNames = new Set(Object.keys(REQUIRED_TABLE_PRIVILEGES));
  for (const policy of inspection.policies) {
    const record = assertRecord(policy, 'policyの行が不正です。');
    assertString(record.schema, 'policy schema名がありません。');
    assertString(record.table, 'policy table名がありません。');
    assertString(record.name, 'policy名がありません。');
    assertString(
      record.permissive,
      `${record.schema}.${record.table}.${record.name}: permissive情報がありません。`,
    );
    assertStringArray(
      record.roles,
      `${record.schema}.${record.table}.${record.name}: policy roleが不正です。`,
    );
    assertString(
      record.command,
      `${record.schema}.${record.table}.${record.name}: policy commandがありません。`,
    );
    const key = `${record.schema}.${record.table}.${record.name}`;
    assert.ok(!seen.has(key), `${key}: policyが重複しています。`);
    seen.add(key);
    if (
      record.schema === 'public' &&
      requiredTableNames.has(record.table) &&
      !requiredKeys.has(key)
    )
      assert.fail(`${key}: allowlist外のpolicyを許可してはいけません。`);
    if (record.schema === 'public' && requiredKeys.has(key)) {
      assert.ok(
        record.roles.includes('public') || record.roles.includes('cocolo_app'),
        `${key}: cocolo_appへ適用されるpolicyではありません。`,
      );
    }
  }
  for (const required of REQUIRED_POLICIES) {
    const key = `public.${required.table}.${required.name}`;
    const foundPolicy:
      | DatabaseSecurityInspection['policies'][number]
      | undefined = inspection.policies.find(
      (candidate: DatabaseSecurityInspection['policies'][number]) =>
        candidate.schema === 'public' &&
        candidate.table === required.table &&
        candidate.name === required.name,
    );
    if (!foundPolicy) throw new Error(`${key}: 必須policyがありません。`);
    const policy: DatabaseSecurityInspection['policies'][number] = foundPolicy;
    assert.equal(
      policy.permissive,
      'PERMISSIVE',
      `${key}: policyをPERMISSIVEに固定してください。`,
    );
    assert.equal(
      policy.command,
      required.command,
      `${key}: policy commandが不正です。`,
    );
    assert.ok(
      policy.roles.includes('public') || policy.roles.includes('cocolo_app'),
      `${key}: cocolo_appへ適用されるpolicyではありません。`,
    );
    if (required.usingTokens)
      assertExpression(
        policy.usingExpression,
        required.usingTokens,
        `${key} USING`,
      );
    if (required.withCheckTokens)
      assertExpression(
        policy.withCheckExpression,
        required.withCheckTokens,
        `${key} WITH CHECK`,
      );
  }
}

// 実接続の観測結果をallowlistと照合し、欠落・過剰権限・RLS弱体化を成功扱いにしない。
export function assertDatabaseSecurity(inspection: DatabaseSecurityInspection) {
  assertConnection(inspection);
  assertRole(inspection);
  assertNoMemberships(inspection);
  assertNoOwnership(inspection);
  assertSchemaPrivileges(inspection);
  assertTablePrivileges(inspection);
  assertRls(inspection);
  assertPolicies(inspection);
}

export function verifyDatabaseSecurity(
  environment: NodeJS.ProcessEnv = process.env,
  runner: PsqlRunner = runPsqlQuery,
) {
  const databaseUrl = parseDatabaseUrl(environment.DATABASE_URL);
  const result = runner(databaseUrl);
  if (result.error) throw new Error('PostgreSQL検査コマンドを起動できません。');
  if (result.status !== 0)
    throw new Error('PostgreSQLへ接続または検査できません。');
  assert.ok(result.stdout.trim(), 'PostgreSQL検査結果が空です。');
  const inspection = parseInspection(result.stdout);
  assertDatabaseSecurity(inspection);
  return inspection;
}

function main() {
  const inspection = verifyDatabaseSecurity();
  console.log(
    `PostgreSQLのcocolo_app security boundaryを検証しました（${inspection.connection.database}）。`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
