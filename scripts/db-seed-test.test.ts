import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertFixtureCounts,
  buildFixtureCountQuery,
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
  assert.match(sql, /generate_series\(1, 1001\)/);
  assert.match(sql, /1,001チーム×10人=10,010人/);
  assert.match(sql, /attendance_responses/);
  assert.match(sql, /guardian_members/);
  assert.match(sql, /line_delivery_outbox/);
  assert.match(sql, /負荷用テナントC/);
  assert.match(sql, /1,002,001件の出欠トランザクション/);
  assert.doesNotMatch(sql, /scale-feature|大量検証機能/);
  assert.match(sql, /'disconnected'::line_connection_status/);
  assert.match(sql, /status = 'completed'/);
  assert.match(sql, /status = 'rejected'/);
  assert.match(sql, /generate_series\(1, 1000\)/);
  assert.deepEqual(scaleFixture, {
    teams: 1_001,
    membersPerTeam: 10,
    members: 10_010,
    guardiansPerMember: 2,
    guardians: 20_020,
    pagerMembers: 1_001,
    pagerAnnouncements: 1_001,
    loadTenantGuardians: 2_002,
    loadTenantEvents: 1_001,
    loadTenantAttendanceResponses: 1_002_001,
    featureDefinitions: 8,
    minimumRowsPerTable: 1_000,
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
  assert.match(sql, /lpad\(\(510000 \+ \(\(team - 1\) \* 20\)/);
});

test('Auth fixtureのチームCユーザーをCのownerへ紐付ける', () => {
  const sql = buildTestDataStatements('auth-user-a', 'auth-user-c').join('\n');
  assert.match(
    sql,
    /'00000000-0000-7000-8000-000000000003', 'auth-user-c', 'owner', 'active'/,
  );
});

test('fixture投入後は全テーブルの最低件数を検証する', () => {
  const query = buildFixtureCountQuery();
  assert.match(query, /count\(\*\)::bigint AS row_count FROM members/);
  assert.doesNotThrow(() =>
    assertFixtureCounts(
      fixtureTables.map((table) => ({ table_name: table, row_count: 1_000 })),
    ),
  );
  assert.throws(
    () =>
      assertFixtureCounts(
        fixtureTables.map((table) => ({
          table_name: table,
          row_count: table === 'events' ? 999 : 1_000,
        })),
      ),
    /fixtureの件数不足: events/,
  );
  assert.throws(
    () =>
      assertFixtureCounts(
        fixtureTables.map((table) => ({
          table_name: table,
          row_count: table === 'feature_definitions' ? 7 : 1_000,
        })),
      ),
    /fixtureの件数不足: feature_definitions/,
  );
});
