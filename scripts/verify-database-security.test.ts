import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDatabaseSecurity,
  type DatabaseSecurityInspection,
  REQUIRED_POLICIES,
  REQUIRED_TABLE_PRIVILEGES,
  verifyDatabaseSecurity,
} from './verify-database-security.ts';

const tablePrivilegeNames = [
  'select',
  'insert',
  'update',
  'delete',
  'truncate',
  'references',
  'trigger',
] as const;

function policyExpression(tokens: readonly string[]) {
  return tokens
    .map((token) => `current_setting('${token}', true)`)
    .join(' AND ');
}

function requireAppRole(inspection: DatabaseSecurityInspection) {
  assert.ok(inspection.appRole);
  return inspection.appRole;
}

function createValidInspection(): DatabaseSecurityInspection {
  const tablePrivileges = Object.entries(REQUIRED_TABLE_PRIVILEGES).map(
    ([table, required]) => {
      const requiredSet = new Set(
        required.map((privilege) => privilege.toLowerCase()),
      );
      return {
        schema: 'public',
        table,
        ...Object.fromEntries(
          tablePrivilegeNames.map((privilege) => [
            privilege,
            requiredSet.has(privilege),
          ]),
        ),
      } as DatabaseSecurityInspection['tablePrivileges'][number];
    },
  );
  const rlsTables = Object.keys(REQUIRED_TABLE_PRIVILEGES).map((table) => ({
    schema: 'public',
    table,
    hasTenantId: table !== 'tenants',
    enabled: true,
    forced: true,
  }));
  const basePolicies = [
    {
      schema: 'public',
      table: 'tenants',
      name: 'tenants_select',
      command: 'SELECT',
      usingExpression: policyExpression(['id', 'app.tenant_id']),
      withCheckExpression: null,
    },
    {
      schema: 'public',
      table: 'tenant_memberships',
      name: 'tenant_memberships_select',
      command: 'SELECT',
      usingExpression: policyExpression([
        'tenant_id',
        'user_id',
        'app.user_id',
      ]),
      withCheckExpression: null,
    },
    {
      schema: 'public',
      table: 'members',
      name: 'members_select',
      command: 'SELECT',
      usingExpression: policyExpression([
        'app.tenant_id',
        'app.role',
        'tenant_id',
        'guardian_members',
      ]),
      withCheckExpression: null,
    },
    {
      schema: 'public',
      table: 'members',
      name: 'members_write',
      command: 'ALL',
      usingExpression: policyExpression([
        'app.tenant_id',
        'app.role',
        'tenant_id',
        'owner',
        'admin',
      ]),
      withCheckExpression: policyExpression([
        'app.tenant_id',
        'app.role',
        'tenant_id',
        'owner',
        'admin',
      ]),
    },
    {
      schema: 'public',
      table: 'guardian_members',
      name: 'guardian_members_select',
      command: 'SELECT',
      usingExpression: policyExpression([
        'app.tenant_id',
        'app.user_id',
        'tenant_id',
        'user_id',
      ]),
      withCheckExpression: null,
    },
    {
      schema: 'public',
      table: 'audit_logs',
      name: 'audit_logs_owner_select',
      command: 'SELECT',
      usingExpression: policyExpression([
        'app.tenant_id',
        'app.role',
        'tenant_id',
        'owner',
      ]),
      withCheckExpression: null,
    },
    {
      schema: 'public',
      table: 'audit_logs',
      name: 'audit_logs_insert',
      command: 'INSERT',
      usingExpression: null,
      withCheckExpression: policyExpression([
        'app.tenant_id',
        'app.user_id',
        'tenant_id',
        'actor_user_id',
      ]),
    },
    {
      schema: 'public',
      table: 'promotion_runs',
      name: 'promotion_runs_admin_write',
      command: 'ALL',
      usingExpression: policyExpression([
        'app.tenant_id',
        'app.role',
        'tenant_id',
        'owner',
        'admin',
      ]),
      withCheckExpression: policyExpression([
        'app.tenant_id',
        'app.role',
        'tenant_id',
        'owner',
        'admin',
      ]),
    },
  ].map((policy) => ({
    ...policy,
    permissive: 'PERMISSIVE',
    roles: ['public'],
  }));
  const basePolicyKeys = new Set(
    basePolicies.map((policy) => `${policy.table}.${policy.name}`),
  );
  const policies = [
    ...basePolicies,
    ...REQUIRED_POLICIES.filter(
      (required) => !basePolicyKeys.has(`${required.table}.${required.name}`),
    ).map((required) => {
      const tokens = required.usingTokens ??
        required.withCheckTokens ?? ['tenant_id'];
      const expression = policyExpression(tokens);
      return {
        schema: 'public',
        table: required.table,
        name: required.name,
        command: required.command,
        usingExpression: required.command === 'INSERT' ? null : expression,
        withCheckExpression:
          required.command === 'INSERT' ||
          required.command === 'UPDATE' ||
          required.command === 'ALL'
            ? expression
            : null,
        permissive: 'PERMISSIVE',
        roles: ['public'],
      };
    }),
  ];

  return {
    connection: {
      currentUser: 'cocolo_app',
      sessionUser: 'cocolo_app',
      database: 'cocolo',
      serverVersion: 'PostgreSQL 17.5',
      serverVersionNum: '170005',
    },
    appRole: {
      rolname: 'cocolo_app',
      rolcanlogin: true,
      rolsuper: false,
      rolinherit: true,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      rolbypassrls: false,
    },
    memberships: [],
    ownedSchemas: [],
    ownedObjects: [],
    schemaPrivileges: [{ schema: 'public', usage: true, create: false }],
    tablePrivileges,
    rlsTables,
    policies,
  };
}

test('有効なPostgreSQL security boundaryを受け入れる', () => {
  assert.doesNotThrow(() => assertDatabaseSecurity(createValidInspection()));
});

test('DATABASE_URL未設定と非PostgreSQL URLを成功扱いにしない', () => {
  let called = false;
  const runner = () => {
    called = true;
    return { status: 0, stdout: '{}' };
  };
  assert.throws(
    () => verifyDatabaseSecurity({}, runner),
    /DATABASE_URL が必要です/,
  );
  assert.throws(
    () =>
      verifyDatabaseSecurity(
        { DATABASE_URL: 'mysql://user:password@example.test/database' },
        runner,
      ),
    /PostgreSQL URL/,
  );
  assert.equal(called, false);
});

test('接続失敗・空結果・不正JSONを成功扱いにしない', () => {
  const environment = {
    DATABASE_URL: 'postgresql://cocolo_app@example.test/cocolo',
  };
  assert.throws(
    () =>
      verifyDatabaseSecurity(environment, () => ({ status: 1, stdout: '' })),
    /接続または検査できません/,
  );
  assert.throws(
    () =>
      verifyDatabaseSecurity(environment, () => ({ status: 0, stdout: '' })),
    /検査結果が空です/,
  );
  assert.throws(
    () =>
      verifyDatabaseSecurity(environment, () => ({
        status: 0,
        stdout: 'not-json',
      })),
    /JSONを解釈できません/,
  );
});

test('PostgreSQL wire互換でもversionがPostgreSQLでなければ拒否する', () => {
  const inspection = createValidInspection();
  const nonPostgres = {
    ...inspection,
    connection: {
      ...inspection.connection,
      serverVersion: 'CockroachDB CCL v24.3.0',
    },
  };
  assert.throws(
    () =>
      verifyDatabaseSecurity(
        { DATABASE_URL: 'postgresql://cocolo_app@example.test/cocolo' },
        () => ({ status: 0, stdout: JSON.stringify(nonPostgres) }),
      ),
    /接続先はPostgreSQL/,
  );
});

test('SUPERUSER・BYPASSRLS・owner・role membershipを拒否する', () => {
  const cases = [
    {
      name: 'SUPERUSER',
      mutate: (inspection: DatabaseSecurityInspection) => ({
        ...inspection,
        appRole: { ...requireAppRole(inspection), rolsuper: true },
      }),
    },
    {
      name: 'BYPASSRLS',
      mutate: (inspection: DatabaseSecurityInspection) => ({
        ...inspection,
        appRole: { ...requireAppRole(inspection), rolbypassrls: true },
      }),
    },
    {
      name: 'owner',
      mutate: (inspection: DatabaseSecurityInspection) => ({
        ...inspection,
        ownedObjects: [{ kind: 'relation', name: 'public.members' }],
      }),
    },
    {
      name: 'role membership',
      mutate: (inspection: DatabaseSecurityInspection) => ({
        ...inspection,
        memberships: [{ role: 'cocolo_owner', adminOption: false }],
      }),
    },
  ];
  for (const { name, mutate } of cases)
    assert.throws(
      () => assertDatabaseSecurity(mutate(createValidInspection())),
      name,
    );
});

test('schema/tableの過剰権限と不足権限を拒否する', () => {
  const withCreate = {
    ...createValidInspection(),
    schemaPrivileges: [{ schema: 'public', usage: true, create: true }],
  };
  assert.throws(() => assertDatabaseSecurity(withCreate), /CREATE/);

  const validWithDelete = createValidInspection();
  const withDelete = {
    ...validWithDelete,
    tablePrivileges: validWithDelete.tablePrivileges.map((table) =>
      table.table === 'members' ? { ...table, delete: true } : table,
    ),
  };
  assert.throws(() => assertDatabaseSecurity(withDelete), /DELETE/);

  const validWithoutAuditLogs = createValidInspection();
  const missingTable = {
    ...validWithoutAuditLogs,
    tablePrivileges: validWithoutAuditLogs.tablePrivileges.filter(
      (table) => table.table !== 'audit_logs',
    ),
  };
  assert.throws(() => assertDatabaseSecurity(missingTable), /必須table/);
});

test('RLS ENABLE/FORCEと必須policyの弱体化を拒否する', () => {
  const validWithDisabledRls = createValidInspection();
  const disabled = {
    ...validWithDisabledRls,
    rlsTables: validWithDisabledRls.rlsTables.map((table) =>
      table.table === 'members' ? { ...table, enabled: false } : table,
    ),
  };
  assert.throws(() => assertDatabaseSecurity(disabled), /RLS ENABLE/);

  const validWithWeakForce = createValidInspection();
  const notForced = {
    ...validWithWeakForce,
    rlsTables: validWithWeakForce.rlsTables.map((table) =>
      table.table === 'audit_logs' ? { ...table, forced: false } : table,
    ),
  };
  assert.throws(() => assertDatabaseSecurity(notForced), /RLS FORCE/);

  const validWithoutPolicy = createValidInspection();
  const missingPolicy = {
    ...validWithoutPolicy,
    policies: validWithoutPolicy.policies.filter(
      (policy) => policy.name !== 'audit_logs_insert',
    ),
  };
  assert.throws(() => assertDatabaseSecurity(missingPolicy), /必須policy/);

  const validWithUnknownPolicy = createValidInspection();
  const extraPolicy = validWithUnknownPolicy.policies.find(
    (policy) => policy.name === 'tenants_select',
  );
  assert.ok(extraPolicy);
  const unknownPolicy = {
    ...validWithUnknownPolicy,
    policies: [
      ...validWithUnknownPolicy.policies,
      { ...extraPolicy, name: 'tenants_all_access' },
    ],
  };
  assert.throws(
    () => assertDatabaseSecurity(unknownPolicy),
    /allowlist外のpolicy/,
  );

  const validWithPermissivePolicy = createValidInspection();
  const permissivePolicy = {
    ...validWithPermissivePolicy,
    policies: validWithPermissivePolicy.policies.map((policy) =>
      policy.name === 'tenants_select'
        ? { ...policy, usingExpression: 'true' }
        : policy,
    ),
  };
  assert.throws(() => assertDatabaseSecurity(permissivePolicy), /常にtrue/);
});
