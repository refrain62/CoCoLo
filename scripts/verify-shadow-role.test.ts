import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertMigrationSqlSafe,
  assertShadowDatabaseSecurity,
  assertShadowRoleAttributes,
  buildExpectedShadowAclEntries,
  expectedShadowObjectOwnerKeys,
  expectedShadowRlsTableNames,
  type ShadowDatabaseInspection,
  type ShadowObjectOwner,
  type ShadowRoleInspection,
} from './verify-shadow-role.ts';

const cleanRole: ShadowRoleInspection = {
  roleName: 'cocolo_shadow',
  currentUser: 'cocolo_shadow',
  isSuperuser: false,
  bypassRls: false,
  canCreateDatabase: false,
  canCreateRole: false,
  canReplicate: false,
  hasMembership: false,
  canLogin: true,
  hasPassword: true,
  passwordHashPrefix: 'SCRAM-SHA-256',
};

test('Shadow roleの安全な属性を受理する', () => {
  assert.doesNotThrow(() =>
    assertShadowRoleAttributes(cleanRole, 'cocolo_shadow'),
  );
});

for (const [label, change, message] of [
  ['superuser', { isSuperuser: true }, /superuser/],
  ['bypassrls', { bypassRls: true }, /bypassrls/],
  ['createdb', { canCreateDatabase: true }, /createdb/],
  ['createrole', { canCreateRole: true }, /createrole/],
  ['replication', { canReplicate: true }, /replication/],
  ['membership', { hasMembership: true }, /membership/],
] as const) {
  test(`悪性fixture: ${label}を拒否する`, () => {
    assert.throws(
      () =>
        assertShadowRoleAttributes(
          { ...cleanRole, ...change },
          'cocolo_shadow',
        ),
      message,
    );
  });
}

const cleanObjectOwners: ShadowObjectOwner[] =
  expectedShadowObjectOwnerKeys.map((key) => {
    const [objectType, ...objectName] = key.split(':');
    return {
      objectType: objectType as ShadowObjectOwner['objectType'],
      objectName: objectName.join(':'),
      owner: 'cocolo_shadow',
    };
  });

const cleanDatabase: ShadowDatabaseInspection = {
  databaseOwner: 'cocolo_shadow',
  objectOwners: cleanObjectOwners,
  aclEntries: buildExpectedShadowAclEntries(cleanObjectOwners),
  defaultAclEntries: [],
  memberships: [
    { roleName: 'pg_read_all_settings', memberName: 'pg_monitor' },
    { roleName: 'pg_read_all_stats', memberName: 'pg_monitor' },
    { roleName: 'pg_stat_scan_tables', memberName: 'pg_monitor' },
  ],
  rls: expectedShadowRlsTableNames.map((tableName) => ({
    tableName,
    enabled: true,
    forced: true,
  })),
};

test('Shadow DBのowner・ACL・RLSの許可集合を受理する', () => {
  assert.doesNotThrow(() =>
    assertShadowDatabaseSecurity(cleanDatabase, 'cocolo_shadow'),
  );
});

for (const [label, change, message] of [
  [
    'PUBLIC grant',
    {
      aclEntries: [
        ...cleanDatabase.aclEntries,
        {
          objectType: 'table' as const,
          objectName: 'public.tenants',
          grantee: 'PUBLIC',
          privilege: 'SELECT',
        },
      ],
    },
    /PUBLIC/,
  ],
  ['DB owner', { databaseOwner: 'postgres' }, /DBのowner/],
  [
    'default privileges',
    {
      defaultAclEntries: [
        {
          objectType: 'table' as const,
          objectName: 'public',
          grantee: 'cocolo_app',
          privilege: 'SELECT',
        },
      ],
    },
    /default privileges/,
  ],
  [
    'membership',
    {
      memberships: [
        ...cleanDatabase.memberships,
        { roleName: 'cocolo_shadow', memberName: 'postgres' },
      ],
    },
    /pg_auth_members/,
  ],
  [
    'RLS disabled',
    {
      rls: cleanDatabase.rls.map((table) =>
        table.tableName === 'public.tenants'
          ? { ...table, enabled: false }
          : table,
      ),
    },
    /RLS無効化/,
  ],
] as const) {
  test(`悪性fixture: Shadow DB ${label}を拒否する`, () => {
    assert.throws(
      () =>
        assertShadowDatabaseSecurity(
          { ...cleanDatabase, ...change },
          'cocolo_shadow',
        ),
      message,
    );
  });
}

test('危険なmigration DDLを拒否する', () => {
  assert.doesNotThrow(() =>
    assertMigrationSqlSafe('ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;'),
  );
  assert.throws(
    () => assertMigrationSqlSafe('DROP TABLE tenants;'),
    /危険なDDL/,
  );
  assert.throws(
    () => assertMigrationSqlSafe('GRANT SELECT ON tenants TO PUBLIC;'),
    /危険なDDL/,
  );
  assert.throws(
    () =>
      assertMigrationSqlSafe('ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;'),
    /危険なDDL/,
  );
});
