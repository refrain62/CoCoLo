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
  appRoleOwnsSchema: false,
  appRoleOwnsSequence: false,
  appRoleOwnsFunction: false,
  appRoleOwnsType: false,
  publicHasTableGrant: false,
  publicSchemaCreateGrant: false,
  publicSchemaAclDrift: false,
  publicSchemaOwnerIsApp: false,
  publicSequenceGrant: false,
  sequenceGrantDrift: false,
  rlsDrift: false,
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
      isGrantable: false,
    })),
  ),
  securityDefinerPublicExecute: false,
  securityDefinerAppExecute: true,
  securityDefinerOwnerIsApp: false,
  securityDefinerHasSafeSearchPath: true,
  securityDefinerUnexpectedFunction: false,
  securityDefinerUnexpectedGrant: false,
  securityDefinerAppGrantOption: false,
};

test('最小権限のDB security検査fixtureを受け入れる', () => {
  assert.doesNotThrow(() => assertDatabaseSecurity(safe));
});

test('role membership・table owner・PUBLIC grantのdriftを拒否する', () => {
  for (const change of [
    { appRoleHasMembership: true },
    { appRoleOwnsTable: true },
    { appRoleOwnsSchema: true },
    { appRoleOwnsSequence: true },
    { appRoleOwnsFunction: true },
    { appRoleOwnsType: true },
    { publicHasTableGrant: true },
    { publicSchemaCreateGrant: true },
    { publicSchemaAclDrift: true },
    { publicSchemaOwnerIsApp: true },
    { publicSequenceGrant: true },
    { sequenceGrantDrift: true },
    { rlsDrift: true },
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
  for (const change of [
    { securityDefinerUnexpectedFunction: true },
    { securityDefinerUnexpectedGrant: true },
    { securityDefinerAppGrantOption: true },
    { securityDefinerHasSafeSearchPath: false },
  ])
    assert.throws(() => assertDatabaseSecurity({ ...safe, ...change }));
  assert.throws(() =>
    assertDatabaseSecurity({
      ...safe,
      appTableGrants: safe.appTableGrants.map((grant, index) =>
        index === 0 ? { ...grant, isGrantable: true } : grant,
      ),
    }),
  );
});
