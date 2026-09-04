import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../../../packages/db/prisma/migrations/20260826100000_member_self_invitations/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

test('本人・保護者招待のguardian_members RLSはlinkTypeを受諾値へ束縛する', () => {
  assert.match(
    migration,
    /ADD COLUMN link_type member_link_type NOT NULL DEFAULT 'guardian'::member_link_type/,
  );
  assert.match(
    migration,
    /CREATE POLICY guardian_members_invitation_insert[\s\S]*?link_type = NULLIF\(current_setting\('app\.invitation_link_type', true\), ''\)::member_link_type[\s\S]*?current_setting\('app\.invitation_accepting', true\) = 'true'/,
  );
  assert.match(
    migration,
    /CREATE POLICY guardian_members_invitation_update[\s\S]*?WITH CHECK \([\s\S]*?link_type = NULLIF\(current_setting\('app\.invitation_link_type', true\), ''\)::member_link_type[\s\S]*?status = 'active'::member_link_status/,
  );
});
