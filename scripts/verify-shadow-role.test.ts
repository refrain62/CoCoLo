import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertShadowRoleAttributes,
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
