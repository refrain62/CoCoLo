import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTestDataStatements,
  fixtureTables,
  scaleFixture,
  testTenantIds,
} from './db-seed-test.ts';

test('ローカルfixtureは全業務テーブルと規模検証データを定義する', () => {
  const sql = buildTestDataStatements().join('\n');
  const expectedTables = [
    'feature_definitions',
    'tenants',
    'tenant_plans',
    'tenant_feature_flags',
    'tenant_memberships',
    'auth_identities',
    'auth_invitations',
    'members',
    'guardian_members',
    'audit_logs',
    'promotion_runs',
    'attachments',
    'events',
    'attendance_responses',
    'board_contacts',
    'purchase_orders',
    'order_products',
    'order_entries',
    'order_lines',
    'order_idempotency_keys',
    'announcements',
    'announcement_attachments',
    'announcement_reads',
    'line_connections',
    'line_notification_queue',
    'line_webhook_receipts',
    'line_delivery_outbox',
    'ride_plans',
    'ride_offers',
    'ride_requests',
    'ride_assignments',
  ];

  assert.deepEqual([...fixtureTables], expectedTables);
  assert.match(sql, /generate_series\(1, 500\)/);
  assert.match(sql, /generate_series\(1, 101\)/);
  assert.match(sql, /500チーム×10人=5,000人/);
  assert.match(sql, /attendance_responses/);
  assert.match(sql, /guardian_members/);
  assert.match(sql, /line_delivery_outbox/);
  assert.deepEqual(scaleFixture, {
    teams: 500,
    membersPerTeam: 10,
    members: 5_000,
    guardiansPerMember: 2,
    guardians: 10_000,
    pagerMembers: 101,
    pagerAnnouncements: 101,
  });
  assert.deepEqual(testTenantIds, {
    tenantA: '00000000-0000-7000-8000-000000000001',
    tenantB: '00000000-0000-7000-8000-000000000002',
    tenantC: '00000000-0000-7000-8000-000000000003',
  });
});

test('規模fixtureの生成IDはUUIDv7形式を保つ', () => {
  const sql = buildTestDataStatements().join('\n');
  assert.match(sql, /00000000-0000-7000-8000/);
  assert.match(sql, /lpad\(\(10000 \+ series\)::text, 12, '0'\)/);
  assert.match(
    sql,
    /lpad\(\(20000 \+ \(\(team - 1\) \* 10\) \+ member\)::text, 12, '0'\)/,
  );
  assert.match(sql, /lpad\(\(30000 \+ \(\(team - 1\) \* 20\)/);
});
