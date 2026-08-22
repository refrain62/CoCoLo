import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertDatabaseSecurity,
  type DatabaseSecurityInspection,
} from './verify-database-security.ts';

const safe: DatabaseSecurityInspection = {
  currentUser: 'postgres',
  appRoleExists: true,
  appRoleIsSuperuser: false,
  appRoleBypassesRls: false,
  appRoleCanCreateRole: false,
  appRoleCanCreateDatabase: false,
  appRoleCanReplicate: false,
  appRoleHasMembership: false,
  appRoleOwnsTable: false,
  publicHasTableGrant: false,
  appTableGrants: [
    'tenants',
    'tenant_memberships',
    'members',
    'guardian_members',
    'audit_logs',
    'promotion_runs',
  ].flatMap((tableName) =>
    ['SELECT', 'INSERT', 'UPDATE'].map((privilegeType) => ({
      tableName,
      privilegeType,
    })),
  ),
  securityDefinerPublicExecute: false,
  securityDefinerAppExecute: true,
  securityDefinerOwnerIsApp: false,
  securityDefinerHasSafeSearchPath: true,
};

test('最小権限のDB security検査fixtureを受け入れる', () => {
  assert.doesNotThrow(() => assertDatabaseSecurity(safe));
});

test('role membership・table owner・PUBLIC grantのdriftを拒否する', () => {
  for (const change of [
    { appRoleHasMembership: true },
    { appRoleOwnsTable: true },
    { publicHasTableGrant: true },
  ])
    assert.throws(() => assertDatabaseSecurity({ ...safe, ...change }));
});

test('SECURITY DEFINERのPUBLIC executeとapp ownerを拒否する', () => {
  assert.throws(() =>
    assertDatabaseSecurity({ ...safe, securityDefinerPublicExecute: true }),
  );
  assert.throws(() =>
    assertDatabaseSecurity({ ...safe, securityDefinerOwnerIsApp: true }),
  );
});
