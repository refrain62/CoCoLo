import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDatabaseSecurity,
  type DatabaseAclEntry,
  type DatabasePolicyInspection,
  type DatabaseSecurityInspection,
} from './database-security.ts';

const tableNames = [
  'public.tenants',
  'public.tenant_memberships',
  'public.members',
  'public.guardian_members',
  'public.audit_logs',
  'public.promotion_runs',
];

const policies: DatabasePolicyInspection[] = [
  {
    tableName: 'public.tenants',
    policyName: 'tenants_select',
    permissive: 'PERMISSIVE',
    roles: ['public'],
    command: 'SELECT',
    usingExpression:
      "id = NULLIF(current_setting('app.tenant_id', true), '')::uuid",
    withCheckExpression: null,
  },
  {
    tableName: 'public.tenant_memberships',
    policyName: 'tenant_memberships_select',
    permissive: 'PERMISSIVE',
    roles: ['public'],
    command: 'SELECT',
    usingExpression:
      "user_id = current_setting('app.user_id', true) AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid",
    withCheckExpression: null,
  },
  {
    tableName: 'public.members',
    policyName: 'members_select',
    permissive: 'PERMISSIVE',
    roles: ['public'],
    command: 'SELECT',
    usingExpression:
      "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND current_setting('app.role', true) = 'staff' AND EXISTS (SELECT 1 FROM guardian_members WHERE user_id = current_setting('app.user_id', true))",
    withCheckExpression: null,
  },
  {
    tableName: 'public.members',
    policyName: 'members_write',
    permissive: 'PERMISSIVE',
    roles: ['public'],
    command: 'ALL',
    usingExpression:
      "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND current_setting('app.role', true) IN ('owner', 'admin')",
    withCheckExpression:
      "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND current_setting('app.role', true) IN ('owner', 'admin')",
  },
  {
    tableName: 'public.guardian_members',
    policyName: 'guardian_members_select',
    permissive: 'PERMISSIVE',
    roles: ['public'],
    command: 'SELECT',
    usingExpression:
      "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND user_id = current_setting('app.user_id', true)",
    withCheckExpression: null,
  },
  {
    tableName: 'public.audit_logs',
    policyName: 'audit_logs_owner_select',
    permissive: 'PERMISSIVE',
    roles: ['public'],
    command: 'SELECT',
    usingExpression:
      "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND current_setting('app.role', true) = 'owner'",
    withCheckExpression: null,
  },
  {
    tableName: 'public.audit_logs',
    policyName: 'audit_logs_insert',
    permissive: 'PERMISSIVE',
    roles: ['public'],
    command: 'INSERT',
    usingExpression: null,
    withCheckExpression:
      "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND actor_user_id = current_setting('app.user_id', true)",
  },
  {
    tableName: 'public.promotion_runs',
    policyName: 'promotion_runs_admin_write',
    permissive: 'PERMISSIVE',
    roles: ['public'],
    command: 'ALL',
    usingExpression:
      "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND current_setting('app.role', true) IN ('owner', 'admin')",
    withCheckExpression:
      "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND current_setting('app.role', true) IN ('owner', 'admin')",
  },
];

const aclEntries: DatabaseAclEntry[] = [
  {
    objectType: 'schema',
    objectName: 'public',
    grantee: 'cocolo_app',
    privilege: 'USAGE',
  },
  {
    objectType: 'function',
    objectName: 'public.app_guard_promotion_run_transition()',
    grantee: 'cocolo_app',
    privilege: 'EXECUTE',
  },
  {
    objectType: 'schema',
    objectName: 'public',
    grantee: 'line_delivery_worker',
    privilege: 'USAGE',
  },
  ...tableNames.flatMap((objectName) =>
    (objectName === 'public.audit_logs'
      ? ['INSERT', 'SELECT']
      : ['INSERT', 'SELECT', 'UPDATE']
    ).map((privilege) => ({
      objectType: 'table' as const,
      objectName,
      grantee: 'cocolo_app',
      privilege,
    })),
  ),
  ...[
    'public.role',
    'public.membership_status',
    'public.member_category',
    'public.member_status',
    'public.promotion_run_status',
  ].map((objectName) => ({
    objectType: 'enum' as const,
    objectName,
    grantee: 'cocolo_app',
    privilege: 'USAGE',
  })),
];

const cleanInspection: DatabaseSecurityInspection = {
  appIdentity: {
    currentUser: 'cocolo_app',
    currentDatabase: 'cocolo_test',
    serverAddress: '127.0.0.1',
    serverPort: 5432,
  },
  adminIdentity: {
    currentUser: 'postgres',
    currentDatabase: 'cocolo_test',
    serverAddress: '127.0.0.1',
    serverPort: 5432,
  },
  appRole: {
    roleName: 'cocolo_app',
    isSuperuser: false,
    bypassRls: false,
    canCreateDatabase: false,
    canCreateRole: false,
    canReplicate: false,
    canLogin: true,
    hasMembership: false,
  },
  databaseOwner: 'postgres',
  schemaOwner: 'pg_database_owner',
  schemaOwners: [{ schemaName: 'public', owner: 'pg_database_owner' }],
  objectOwners: [
    {
      objectType: 'table',
      objectName: 'public._prisma_migrations',
      owner: 'postgres',
    },
    ...tableNames.map((objectName) => ({
      objectType: 'table' as const,
      objectName,
      owner: 'postgres',
    })),
    ...[
      'public.role',
      'public.membership_status',
      'public.member_category',
      'public.member_status',
      'public.promotion_run_status',
    ].map((objectName) => ({
      objectType: 'enum' as const,
      objectName,
      owner: 'postgres',
    })),
  ],
  aclEntries,
  defaultAclEntries: [],
  memberships: [
    { roleName: 'pg_read_all_settings', memberName: 'pg_monitor' },
    { roleName: 'pg_read_all_stats', memberName: 'pg_monitor' },
    { roleName: 'pg_stat_scan_tables', memberName: 'pg_monitor' },
  ],
  rls: tableNames.map((tableName) => ({
    tableName,
    enabled: true,
    forced: true,
  })),
  policies,
  functions: [
    {
      functionName: 'public.app_guard_promotion_run_transition()',
      owner: 'postgres',
      securityDefiner: false,
      searchPathConfig: 'search_path=pg_catalog, public',
      aclEntries: [{ grantee: 'cocolo_app', privilege: 'EXECUTE' }],
    },
  ],
};

test('実アプリDBのrole・owner・ACL・RLS・policy・functionを受理する', () => {
  assert.doesNotThrow(() =>
    assertDatabaseSecurity(cleanInspection, {
      appRole: 'cocolo_app',
      adminRole: 'postgres',
    }),
  );
});

test('USING(true)とpolicyのDROP/置換相当の欠落を拒否する', () => {
  assert.throws(
    () =>
      assertDatabaseSecurity(
        {
          ...cleanInspection,
          policies: cleanInspection.policies
            .filter((policy) => policy.policyName !== 'members_select')
            .map((policy) =>
              policy.policyName === 'tenants_select'
                ? { ...policy, usingExpression: 'true' }
                : policy,
            ),
        },
        { appRole: 'cocolo_app', adminRole: 'postgres' },
      ),
    /RLS policy名/,
  );
  assert.throws(
    () =>
      assertDatabaseSecurity(
        {
          ...cleanInspection,
          policies: cleanInspection.policies.map((policy) =>
            policy.policyName === 'tenants_select'
              ? { ...policy, usingExpression: 'true' }
              : policy,
          ),
        },
        { appRole: 'cocolo_app', adminRole: 'postgres' },
      ),
    /無条件のtrue/,
  );
});

test('PUBLIC function ACL・SECURITY DEFINER・app roleのbypassrlsを拒否する', () => {
  for (const inspection of [
    {
      ...cleanInspection,
      appRole: { ...cleanInspection.appRole, bypassRls: true },
    },
    {
      ...cleanInspection,
      functions: cleanInspection.functions.map((fn) => ({
        ...fn,
        securityDefiner: true,
      })),
    },
    {
      ...cleanInspection,
      functions: cleanInspection.functions.map((fn) => ({
        ...fn,
        aclEntries: [{ grantee: 'PUBLIC', privilege: 'EXECUTE' }],
      })),
    },
  ])
    assert.throws(() =>
      assertDatabaseSecurity(inspection, {
        appRole: 'cocolo_app',
        adminRole: 'postgres',
      }),
    );
});
