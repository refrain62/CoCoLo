import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../../../packages/db/prisma/migrations/20260823140000_phase2_event_security_hardening/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const repository = readFileSync(
  new URL('../../../packages/db/src/event-repository.ts', import.meta.url),
  'utf8',
);

test('EVT-001のmigrationはactive membership、添付tenant、回答一意性をDBで固定する', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION app_is_active_member\(/);
  assert.match(migration, /app_is_active_member_with_role/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION app_is_live_member\(/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION app_is_live_member\(uuid, uuid\) FROM PUBLIC/,
  );
  assert.match(migration, /events_tenant_attachment_fk/);
  assert.match(migration, /予定migration前提違反/);
  assert.doesNotMatch(migration, /NOT VALID/);
  assert.match(migration, /event_attachment_state_guard/);
  assert.match(migration, /app_is_live_member\(tenant_id, member_id\)/);
  assert.doesNotMatch(
    migration,
    /DELETE FROM attendance_responses AS responses/,
  );
  assert.match(
    migration,
    /attendance_select[\s\S]*user_id = current_setting\('app.user_id', true\)/,
  );
  assert.match(
    migration,
    /attendance_select[\s\S]*app_is_active_member_with_role[\s\S]*guardian_members/,
  );
});

test('EVT-001 repositoryはmembership変更と業務transactionを直列化する', () => {
  assert.match(repository, /pg_advisory_xact_lock\(hashtextextended/);
  assert.match(repository, /FROM tenant_memberships[\s\S]*FOR SHARE/);
  assert.match(repository, /FROM guardian_members[\s\S]*FOR SHARE/);
  assert.match(repository, /FROM events[\s\S]*FOR UPDATE/);
  assert.match(repository, /status = 'available'::attachment_status/);
  assert.match(repository, /LIMIT 501/);
});
