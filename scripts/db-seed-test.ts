import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { withPostgresClient } from './postgres-client.ts';
import { assertTestDatabaseTarget } from './test-database-guard.ts';

export const testTenantIds = {
  tenantA: '00000000-0000-7000-8000-000000000001',
  tenantB: '00000000-0000-7000-8000-000000000002',
  tenantC: '00000000-0000-7000-8000-000000000003',
} as const;

export const scaleFixture = {
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
  eventsPerTeam: 200,
  scaleEvents: 200_200,
  attendanceResponsesPerTeam: 200,
  scaleAttendanceResponses: 200_200,
  boardContactsPerTeam: 100,
  loadTenantBoardContacts: 100_100,
  featureDefinitions: 8,
  minimumRowsPerTable: 1_000,
} as const;

export const fixtureTables = [
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
] as const;

export const fixtureMinimumRows: Partial<
  Record<(typeof fixtureTables)[number], number>
> = {
  feature_definitions: scaleFixture.featureDefinitions,
};

type FixtureCountRow = {
  table_name: string;
  row_count: bigint | number | string;
};

const uuid = (suffix: number) =>
  `00000000-0000-7000-8000-${String(suffix).padStart(12, '0')}`;
const sql = String.raw;

function assertAuthUserId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  assert.match(
    normalized,
    /^[0-9a-f-]{36}$/i,
    'TEST_AUTH_USER_IDはUUIDである必要があります。',
  );
  return normalized;
}

// 既存のlocal E2E固定IDを維持し、状態境界とページャー閾値を同じDBで再現する。
export function buildTestDataStatements(
  authUserId?: string,
  authTeamCUserId?: string,
): readonly string[] {
  const { tenantA, tenantB, tenantC } = testTenantIds;
  const statements: string[] = [
    sql`
INSERT INTO tenants (id, name)
VALUES
  ('${tenantA}', 'テストチームA'),
  ('${tenantB}', 'テストチームB'),
  ('${tenantC}', 'テストチームC（状態境界・大量データ）')
ON CONFLICT (id) DO NOTHING;
`,
    sql`
-- 実運用の規模検証用。1,001チームを各10部員で作り、tenant境界と一覧性能を確認する。
INSERT INTO tenants (id, name)
SELECT
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  '大量検証チーム' || lpad(series::text, 4, '0')
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO tenant_memberships (id, tenant_id, user_id, role, status)
VALUES
  ('${uuid(101)}', '${tenantA}', 'owner-a', 'owner', 'active'),
  ('${uuid(102)}', '${tenantA}', 'guardian-a', 'guardian', 'active'),
  ('${uuid(103)}', '${tenantB}', 'owner-b', 'owner', 'active'),
  ('${uuid(105)}', '${tenantA}', 'admin-a', 'admin', 'active'),
  ('${uuid(106)}', '${tenantA}', 'staff-a', 'staff', 'active'),
  ('${uuid(107)}', '${tenantA}', 'guardian-a-2', 'guardian', 'active'),
  ('${uuid(108)}', '${tenantC}', 'owner-c', 'owner', 'active'),
  ('${uuid(109)}', '${tenantC}', 'guardian-c', 'guardian', 'active'),
  ('${uuid(110)}', '${tenantA}', 'invited-a', 'guardian', 'invited'),
  ('${uuid(111)}', '${tenantA}', 'suspended-a', 'staff', 'suspended')
ON CONFLICT (tenant_id, user_id) DO UPDATE
SET role = EXCLUDED.role, status = EXCLUDED.status;
`,
    sql`
INSERT INTO tenant_memberships (id, tenant_id, user_id, role, status)
SELECT
  ('00000000-0000-7000-8000-' || lpad((500000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  'club-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END || '-owner',
  'owner'::role,
  'active'::membership_status
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (tenant_id, user_id) DO NOTHING;
`,
    sql`
INSERT INTO tenant_memberships (id, tenant_id, user_id, role, status)
SELECT
  ('00000000-0000-7000-8000-' || lpad((510000 + ((team - 1) * 20) + ((member - 1) * 2) + parent)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + team)::text, 12, '0'))::uuid,
  'club-' || CASE WHEN team >= 1000 THEN team::text ELSE lpad(team::text, 3, '0') END || '-member-' || lpad(member::text, 2, '0') || '-parent-' || parent,
  'guardian'::role,
  'active'::membership_status
FROM generate_series(1, 1001) AS teams(team)
CROSS JOIN generate_series(1, 10) AS members(member)
CROSS JOIN generate_series(1, 2) AS parents(parent)
ON CONFLICT (tenant_id, user_id) DO NOTHING;
`,
    sql`
-- 旧fixtureの仮想機能を再seed時にも残さず、現行機能の定義だけを使う。
DELETE FROM tenant_feature_flags
WHERE left(feature_key, 6) = 'scale-'
  AND substring(feature_key FROM 7) LIKE 'feature-%';
`,
    sql`
DELETE FROM feature_definitions
WHERE left(key, 6) = 'scale-'
  AND substring(key FROM 7) LIKE 'feature-%';
`,
    sql`
INSERT INTO feature_definitions (key, billing_type, display_name, default_enabled)
VALUES
  ('members', 'free', 'メンバー管理', true),
  ('events-attendance', 'free', '予定・出欠', true),
  ('bulletin-board', 'free', '回覧・添付', true),
  ('attachments', 'free', '添付ファイル', true),
  ('orders-payments', 'paid', '購買・集金', false),
  ('line-notifications', 'paid', 'LINE通知', false),
  ('ride-operations', 'paid', '送迎管理', false),
  ('board-contacts', 'free', '役員・連絡先', true)
ON CONFLICT (key) DO NOTHING;
`,
    sql`
INSERT INTO tenant_plans
  (id, tenant_id, plan_key, status, feature_keys, starts_at, ends_at)
VALUES
  ('${uuid(601)}', '${tenantA}', 'local-all', 'active',
   ARRAY['members', 'events-attendance', 'bulletin-board', 'attachments', 'orders-payments', 'line-notifications', 'ride-operations', 'board-contacts']::text[],
   '2026-01-01T00:00:00Z', NULL),
  ('${uuid(602)}', '${tenantB}', 'local-basic', 'trialing',
   ARRAY['members', 'events-attendance', 'bulletin-board', 'attachments']::text[],
   '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z'),
  ('${uuid(603)}', '${tenantC}', 'local-past-due', 'past_due',
   ARRAY['members', 'events-attendance', 'bulletin-board', 'attachments', 'orders-payments', 'line-notifications', 'ride-operations']::text[],
   '2026-01-01T00:00:00Z', NULL)
ON CONFLICT (tenant_id) DO NOTHING;
`,
    sql`
INSERT INTO tenant_plans
  (id, tenant_id, plan_key, status, feature_keys, starts_at, ends_at)
SELECT
  ('00000000-0000-7000-8000-' || lpad((6000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  'local-scale',
  'active'::tenant_plan_status,
  ARRAY['members', 'events-attendance', 'bulletin-board', 'attachments', 'orders-payments', 'line-notifications', 'ride-operations', 'board-contacts']::text[],
  '2026-01-01T00:00:00Z',
  NULL
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (tenant_id) DO NOTHING;
`,
    sql`
INSERT INTO tenant_feature_flags
  (tenant_id, feature_key, enabled, source, changed_by_user_id, reason, starts_at, ends_at)
VALUES
  ('${tenantA}', 'board-contacts', true, 'admin', 'owner-a', 'ローカル開発の管理画面確認', '2026-01-01T00:00:00Z', NULL),
  ('${tenantA}', 'attachments', true, 'admin', 'owner-a', 'ローカル開発の添付確認', '2026-01-01T00:00:00Z', NULL),
  ('${tenantB}', 'board-contacts', false, 'admin', 'owner-b', '未契約チームの無効状態確認', '2026-01-01T00:00:00Z', NULL),
  ('${tenantC}', 'line-notifications', false, 'operator', 'operator-fixture', '支払遅延時の無効状態確認', '2026-01-01T00:00:00Z', NULL)
ON CONFLICT (tenant_id, feature_key) DO NOTHING;
`,
    sql`
INSERT INTO members (id, tenant_id, name, kana, category, grade_level, age_group, status, note)
VALUES
  ('${uuid(201)}', '${tenantA}', 'テスト部員A', 'てすとぶいんえー', 'student', 9, NULL, 'active', NULL),
  ('${uuid(202)}', '${tenantA}', 'テスト部員A2', 'てすとぶいんえーつー', 'student', 8, NULL, 'active', NULL),
  ('${uuid(203)}', '${tenantB}', 'テスト部員B', 'てすとぶいんびー', 'student', 9, NULL, 'active', NULL),
  ('${uuid(204)}', '${tenantA}', 'テスト成人A', 'てすとせいじんえー', 'adult', NULL, '30代', 'active', '運営だけが確認する補足'),
  ('${uuid(205)}', '${tenantA}', '停止中部員A', 'ていしちゅうぶいんえー', 'student', 6, NULL, 'suspended', NULL),
  ('${uuid(206)}', '${tenantA}', '退部済み部員A', 'たいぶずみぶいんえー', 'student', 7, NULL, 'retired', NULL),
  ('${uuid(207)}', '${tenantB}', 'テスト成人B', 'てすとせいじんびー', 'adult', NULL, '50代', 'active', NULL),
  ('${uuid(208)}', '${tenantB}', '停止中部員B', 'ていしちゅうぶいんびー', 'student', 5, NULL, 'suspended', NULL),
  ('${uuid(209)}', '${tenantC}', '境界部員C1', 'きょうかいぶいんしーいち', 'student', 1, NULL, 'active', NULL),
  ('${uuid(210)}', '${tenantC}', '境界部員C12', 'きょうかいぶいんしーじゅうに', 'student', 12, NULL, 'active', NULL),
  ('${uuid(211)}', '${tenantC}', '境界部員C16', 'きょうかいぶいんしーじゅうろく', 'student', 16, NULL, 'active', NULL),
  ('${uuid(212)}', '${tenantC}', '境界部員C17', 'きょうかいぶいんしーじゅうなな', 'student', 17, NULL, 'active', NULL),
  ('${uuid(213)}', '${tenantC}', 'テスト成人C', 'てすとせいじんしー', 'adult', NULL, '20代', 'active', NULL),
  ('${uuid(214)}', '${tenantC}', '停止中部員C', 'ていしちゅうぶいんしー', 'student', 3, NULL, 'suspended', NULL),
  ('${uuid(215)}', '${tenantC}', '退部済み部員C', 'たいぶずみぶいんしー', 'student', 4, NULL, 'retired', NULL)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
-- 1,001チーム×10人=10,010人。active/suspended/retired、student/adultを混在させる。
INSERT INTO members (id, tenant_id, name, kana, category, grade_level, age_group, status, note)
SELECT
  ('00000000-0000-7000-8000-' || lpad((20000 + ((team - 1) * 10) + member)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + team)::text, 12, '0'))::uuid,
  '大量検証部員' || lpad(team::text, 4, '0') || '-' || member,
  'たいりょう' || team || '-' || member,
  CASE WHEN member = 10 THEN 'adult'::member_category ELSE 'student'::member_category END,
  CASE WHEN member = 10 THEN NULL ELSE 1 + ((team + member) % 16) END,
  CASE WHEN member = 10 THEN CASE WHEN team % 2 = 0 THEN '30代' ELSE '40代' END ELSE NULL END,
  CASE WHEN member = 9 AND team % 5 = 0 THEN 'retired'::member_status
       WHEN member = 8 AND team % 7 = 0 THEN 'suspended'::member_status
       ELSE 'active'::member_status END,
  NULL
FROM generate_series(1, 1001) AS teams(team)
CROSS JOIN generate_series(1, 10) AS members(member)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
-- 負荷用テナントCに、ユーザー操作で追加された部員を1,001件用意する。
INSERT INTO members (id, tenant_id, name, kana, category, grade_level, age_group, status, note)
SELECT
  ('00000000-0000-7000-8000-' || lpad((220 + series)::text, 12, '0'))::uuid,
  '${tenantC}',
  '負荷検証部員' || lpad(series::text, 4, '0'),
  'ふかけんしょう' || series,
  CASE WHEN series % 5 = 0 THEN 'adult'::member_category ELSE 'student'::member_category END,
  CASE WHEN series % 5 = 0 THEN NULL ELSE 1 + (series % 16) END,
  CASE WHEN series % 5 = 0 THEN CASE WHEN series % 3 = 0 THEN '30代' ELSE '40代' END ELSE NULL END,
  'active'::member_status,
  NULL
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO guardian_members
  (id, tenant_id, user_id, member_id, relationship, link_type, status, consented_at)
VALUES
  ('${uuid(301)}', '${tenantA}', 'guardian-a', '${uuid(201)}', '母', 'guardian', 'active', '2026-08-20T00:00:00Z'),
  ('${uuid(302)}', '${tenantA}', 'guardian-a-2', '${uuid(202)}', '父', 'guardian', 'active', '2026-08-20T00:00:00Z'),
  ('${uuid(303)}', '${tenantA}', 'self-a', '${uuid(202)}', '本人', 'self', 'active', '2026-08-20T00:00:00Z'),
  ('${uuid(304)}', '${tenantB}', 'guardian-b', '${uuid(203)}', '保護者', 'guardian', 'active', '2026-08-20T00:00:00Z'),
  ('${uuid(305)}', '${tenantC}', 'guardian-c', '${uuid(209)}', '母', 'guardian', 'active', '2026-08-20T00:00:00Z'),
  ('${uuid(306)}', '${tenantC}', 'guardian-c', '${uuid(210)}', '父', 'guardian', 'suspended', NULL),
  ('${uuid(307)}', '${tenantA}', 'guardian-a', '${uuid(206)}', '保護者', 'guardian', 'revoked', NULL)
ON CONFLICT (tenant_id, user_id, member_id) DO NOTHING;
`,
    sql`
-- 負荷用テナントCの部員ごとに、父母のユーザー操作で追加された所属とリンクを作る。
INSERT INTO tenant_memberships (id, tenant_id, user_id, role, status)
SELECT
  ('00000000-0000-7000-8000-' || lpad((540000 + ((member - 1) * 2) + parent)::text, 12, '0'))::uuid,
  '${tenantC}',
  'c-load-member-' || lpad(member::text, 4, '0') || '-parent-' || parent,
  'guardian'::role,
  'active'::membership_status
FROM generate_series(1, 1001) AS members(member)
CROSS JOIN generate_series(1, 2) AS parents(parent)
ON CONFLICT (tenant_id, user_id) DO NOTHING;
`,
    sql`
INSERT INTO guardian_members
  (id, tenant_id, user_id, member_id, relationship, link_type, status, consented_at)
SELECT
  ('00000000-0000-7000-8000-' || lpad((550000 + ((member - 1) * 2) + parent)::text, 12, '0'))::uuid,
  '${tenantC}',
  'c-load-member-' || lpad(member::text, 4, '0') || '-parent-' || parent,
  ('00000000-0000-7000-8000-' || lpad((220 + member)::text, 12, '0'))::uuid,
  CASE WHEN parent = 1 THEN '母' ELSE '父' END,
  'guardian'::member_link_type,
  'active'::member_link_status,
  '2026-08-20T00:00:00Z'::timestamptz
FROM generate_series(1, 1001) AS members(member)
CROSS JOIN generate_series(1, 2) AS parents(parent)
ON CONFLICT (tenant_id, user_id, member_id) DO NOTHING;
`,
    sql`
-- 各部員に父母の2リンクを持たせ、保護者一覧と担当範囲を実運用に近づける。
INSERT INTO guardian_members
  (id, tenant_id, user_id, member_id, relationship, link_type, status, consented_at)
SELECT
  ('00000000-0000-7000-8000-' || lpad((510000 + ((team - 1) * 20) + ((member - 1) * 2) + parent)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + team)::text, 12, '0'))::uuid,
  'club-' || CASE WHEN team >= 1000 THEN team::text ELSE lpad(team::text, 3, '0') END || '-member-' || lpad(member::text, 2, '0') || '-parent-' || parent,
  ('00000000-0000-7000-8000-' || lpad((20000 + ((team - 1) * 10) + member)::text, 12, '0'))::uuid,
  CASE WHEN parent = 1 THEN '母' ELSE '父' END,
  'guardian'::member_link_type,
  CASE WHEN member = 9 AND team % 5 = 0 THEN 'revoked'::member_link_status ELSE 'active'::member_link_status END,
  CASE WHEN member = 9 AND team % 5 = 0 THEN NULL ELSE '2026-08-20T00:00:00Z'::timestamptz END
FROM generate_series(1, 1001) AS teams(team)
CROSS JOIN generate_series(1, 10) AS members(member)
CROSS JOIN generate_series(1, 2) AS parents(parent)
ON CONFLICT (tenant_id, user_id, member_id) DO NOTHING;
`,
    sql`
INSERT INTO auth_identities (id, user_id, provider, provider_subject, revoked_at)
VALUES
  ('${uuid(401)}', 'owner-a', 'google', 'google-owner-a', NULL),
  ('${uuid(402)}', 'guardian-a', 'line', 'line-guardian-a', NULL),
  ('${uuid(403)}', 'staff-a', 'google', 'google-staff-a', '2026-08-21T00:00:00Z'),
  ('${uuid(404)}', 'owner-c', 'line', 'line-owner-c', NULL)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO auth_invitations
  (id, tenant_id, member_id, role, relationship, token_hash, invited_by_user_id, status, expires_at, accepted_at, accepted_by_user_id, revoked_at, created_at, updated_at)
VALUES
  ('${uuid(501)}', '${tenantA}', '${uuid(204)}', 'guardian', '母', repeat('1', 64), 'owner-a', 'pending', '2099-01-01T00:00:00Z', NULL, NULL, NULL, '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z'),
  ('${uuid(502)}', '${tenantA}', '${uuid(205)}', 'guardian', '父', repeat('2', 64), 'admin-a', 'accepted', '2099-01-01T00:00:00Z', '2026-08-20T00:00:00Z', 'guardian-a-2', NULL, '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z'),
  ('${uuid(503)}', '${tenantB}', '${uuid(203)}', 'guardian', '保護者', repeat('3', 64), 'owner-b', 'expired', '2026-01-01T00:00:00Z', NULL, NULL, NULL, '2025-12-01T00:00:00Z', '2025-12-01T00:00:00Z'),
  ('${uuid(504)}', '${tenantC}', '${uuid(209)}', 'guardian', '保護者', repeat('4', 64), 'owner-c', 'revoked', '2099-01-01T00:00:00Z', NULL, NULL, '2026-08-22T00:00:00Z', '2026-08-20T00:00:00Z', '2026-08-22T00:00:00Z')
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO attachments
  (id, tenant_id, owner_user_id, object_key, media_type, byte_size, expires_at)
VALUES
  ('${uuid(2001)}', '${tenantC}', 'owner-c', '${tenantC}/attachments/${uuid(2001)}', 'application/pdf', 1024, '2099-01-01T00:00:00Z'),
  ('${uuid(2002)}', '${tenantC}', 'owner-c', '${tenantC}/attachments/${uuid(2002)}', 'image/png', 2048, '2099-01-01T00:00:00Z'),
  ('${uuid(2003)}', '${tenantC}', 'owner-c', '${tenantC}/attachments/${uuid(2003)}', 'image/jpeg', 4096, '2099-01-01T00:00:00Z'),
  ('${uuid(2004)}', '${tenantC}', 'owner-c', '${tenantC}/attachments/${uuid(2004)}', 'application/pdf', 512, '2099-01-01T00:00:00Z'),
  ('${uuid(2005)}', '${tenantC}', 'owner-c', '${tenantC}/attachments/${uuid(2005)}', 'image/png', 1024, '2099-01-01T00:00:00Z'),
  ('${uuid(2006)}', '${tenantC}', 'owner-c', '${tenantC}/attachments/${uuid(2006)}', 'application/pdf', 128, '2099-01-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;
`,
    sql`
UPDATE attachments
SET status = 'available', sha256 = repeat('a', 64), available_at = '2026-08-25T00:00:00Z', complete_attempts = 1
WHERE id IN ('${uuid(2001)}', '${uuid(2005)}', '${uuid(2006)}') AND status = 'uploaded';
`,
    sql`
UPDATE attachments
SET status = 'rejected', cleanup_attempts = 1
WHERE id = '${uuid(2003)}' AND status = 'uploaded';
`,
    sql`
UPDATE attachments
SET status = 'available', sha256 = repeat('b', 64), available_at = '2026-08-25T00:00:00Z', complete_attempts = 1
WHERE id = '${uuid(2004)}' AND status = 'uploaded';
`,
    sql`
UPDATE attachments
SET status = 'deleted', deleted_at = '2026-08-26T00:00:00Z', cleanup_attempts = 2
WHERE id = '${uuid(2004)}' AND status = 'available';
`,
    sql`
INSERT INTO events
  (id, tenant_id, title, event_type, starts_at, ends_at, location, items_to_bring, fee, announcement_image_attachment_id, opponent, meeting_time, transportation_required, attendance_deadline, created_by_user_id, updated_by_user_id)
VALUES
  ('${uuid(1001)}', '${tenantC}', '通常練習（回答受付中）', 'practice', '2099-02-01T10:00:00Z', '2099-02-01T12:00:00Z', '市民体育館', '飲み物、タオル', 0, NULL, NULL, NULL, false, '2099-01-30T23:59:00Z', 'owner-c', 'owner-c'),
  ('${uuid(1002)}', '${tenantC}', '対外試合（送迎あり）', 'match', '2099-02-08T09:00:00Z', '2099-02-08T16:00:00Z', '県立競技場', 'ユニフォーム、昼食', 1500, NULL, 'テストクラブB', '2099-02-08T07:30:00Z', true, '2099-02-05T23:59:00Z', 'owner-c', 'owner-c'),
  ('${uuid(1003)}', '${tenantC}', '過去イベント（締切後）', 'event', '2020-02-15T10:00:00Z', '2020-02-15T12:00:00Z', '交流センター', NULL, 500, NULL, NULL, NULL, false, '2020-02-10T23:59:00Z', 'owner-c', 'owner-c'),
  ('${uuid(1004)}', '${tenantC}', '資料付きイベント', 'event', '2099-03-01T13:00:00Z', '2099-03-01T15:00:00Z', '多目的ホール', '筆記用具', 300, '${uuid(2001)}', NULL, NULL, false, '2099-02-25T23:59:00Z', 'owner-c', 'owner-c'),
  ('${uuid(1005)}', '${tenantC}', 'Bチーム練習', 'practice', '2099-02-02T10:00:00Z', '2099-02-02T12:00:00Z', 'B体育館', NULL, 0, NULL, NULL, NULL, false, '2099-01-30T23:59:00Z', 'owner-c', 'owner-c'),
  ('${uuid(1006)}', '${tenantC}', 'C境界イベント', 'event', '2099-03-03T10:00:00Z', '2099-03-03T12:00:00Z', 'C会場', NULL, 1000000, NULL, NULL, NULL, false, '2099-03-01T23:59:00Z', 'owner-c', 'owner-c')
ON CONFLICT (id) DO NOTHING;
`,
    sql`
-- 1,001チームへユーザー操作で作成された予定を各200件、合計200,200件用意する。
INSERT INTO events
  (id, tenant_id, title, event_type, starts_at, ends_at, location, items_to_bring, fee, opponent, meeting_time, transportation_required, attendance_deadline, created_by_user_id, updated_by_user_id)
SELECT
  ('00000000-0000-7000-8000-' || lpad((CASE WHEN event_number = 1 THEN 7000 + team ELSE 8000000 + ((team - 1) * 199) + event_number END)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + team)::text, 12, '0'))::uuid,
  'チーム活動' || lpad(team::text, 4, '0') || '-' || lpad(event_number::text, 3, '0'),
  CASE event_number % 4
    WHEN 0 THEN 'practice'::event_type
    WHEN 1 THEN 'match'::event_type
    WHEN 2 THEN 'event'::event_type
    ELSE 'practice'::event_type
  END,
  timestamp '2099-04-01T10:00:00Z' + (event_number || ' days')::interval,
  timestamp '2099-04-01T12:00:00Z' + (event_number || ' days')::interval,
  CASE WHEN event_number % 5 = 0 THEN NULL ELSE '大量検証会場' || team || '-' || event_number END,
  CASE event_number % 3 WHEN 0 THEN NULL WHEN 1 THEN '飲み物、タオル' ELSE 'ユニフォーム、昼食' END,
  CASE event_number % 5 WHEN 0 THEN 0 WHEN 1 THEN 500 ELSE 1500 + (event_number % 4) * 1000 END,
  CASE WHEN event_number % 4 = 1 THEN '対戦チーム' || team || '-' || event_number ELSE NULL END,
  CASE WHEN event_number % 4 = 1 THEN timestamp '2099-04-01T08:00:00Z' + (event_number || ' days')::interval ELSE NULL END,
  event_number % 2 = 0,
  timestamp '2099-03-30T23:59:00Z' + (event_number || ' days')::interval,
  'club-' || CASE WHEN team >= 1000 THEN team::text ELSE lpad(team::text, 3, '0') END || '-owner',
  'club-' || CASE WHEN team >= 1000 THEN team::text ELSE lpad(team::text, 3, '0') END || '-owner'
FROM generate_series(1, 1001) AS teams(team)
CROSS JOIN generate_series(1, 200) AS event_numbers(event_number)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
-- 負荷用テナントCに、ユーザーが作成した予定を1,001件用意する。
INSERT INTO events
  (id, tenant_id, title, event_type, starts_at, ends_at, location, items_to_bring, fee, opponent, meeting_time, transportation_required, attendance_deadline, created_by_user_id, updated_by_user_id)
SELECT
  ('00000000-0000-7000-8000-' || lpad((7100000 + series)::text, 12, '0'))::uuid,
  '${tenantC}',
  '負荷検証予定' || lpad(series::text, 4, '0'),
  CASE series % 3
    WHEN 0 THEN 'practice'::event_type
    WHEN 1 THEN 'match'::event_type
    ELSE 'event'::event_type
  END,
  timestamp '2099-06-01T10:00:00Z' + (series || ' days')::interval,
  timestamp '2099-06-01T12:00:00Z' + (series || ' days')::interval,
  '負荷検証会場' || series,
  CASE WHEN series % 2 = 0 THEN '飲み物、タオル' ELSE NULL END,
  CASE WHEN series % 3 = 0 THEN 0 ELSE 500 END,
  CASE WHEN series % 3 = 1 THEN '対戦チーム' || series ELSE NULL END,
  CASE WHEN series % 3 = 1 THEN timestamp '2099-06-01T08:00:00Z' + (series || ' days')::interval ELSE NULL END,
  series % 2 = 1,
  timestamp '2099-05-29T23:59:00Z' + (series || ' days')::interval,
  'owner-c',
  'owner-c'
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
WITH fixture_session AS (
  SELECT set_config('app.tenant_id', '${tenantC}', true), set_config('app.user_id', 'guardian-c', true), set_config('app.role', 'guardian', true)
)
INSERT INTO attendance_responses (id, tenant_id, event_id, user_id, member_id, response)
SELECT '${uuid(1101)}', '${tenantC}', '${uuid(1001)}', 'guardian-c', '${uuid(209)}', 'attending'::attendance_response
FROM fixture_session
ON CONFLICT (tenant_id, event_id, user_id, member_id) DO NOTHING;
`,
    sql`
-- 各チームの各部員について父母のうち母側がpendingで回答する大量出欠データ。
DO $fixture$
DECLARE
  team integer;
  member integer;
  v_team_id uuid;
  v_event_id uuid;
  v_member_id uuid;
  v_user_id varchar(128);
  v_response_id uuid;
BEGIN
  FOR team IN 1..1001 LOOP
    v_team_id := ('00000000-0000-7000-8000-' || lpad((10000 + team)::text, 12, '0'))::uuid;
    v_event_id := ('00000000-0000-7000-8000-' || lpad((7000 + team)::text, 12, '0'))::uuid;
    FOR member IN 1..10 LOOP
      v_member_id := ('00000000-0000-7000-8000-' || lpad((20000 + ((team - 1) * 10) + member)::text, 12, '0'))::uuid;
      v_user_id := 'club-' || CASE WHEN team >= 1000 THEN team::text ELSE lpad(team::text, 3, '0') END || '-member-' || lpad(member::text, 2, '0') || '-parent-1';
      v_response_id := ('00000000-0000-7000-8000-' || lpad((900000 + ((team - 1) * 10) + member)::text, 12, '0'))::uuid;
      IF NOT (member = 9 AND team % 5 = 0) THEN
        PERFORM set_config('app.tenant_id', v_team_id::text, true);
        PERFORM set_config('app.user_id', v_user_id, true);
        PERFORM set_config('app.role', 'guardian', true);
        INSERT INTO attendance_responses (id, tenant_id, event_id, user_id, member_id, response)
        VALUES (
          v_response_id,
          v_team_id,
          v_event_id,
          v_user_id,
          v_member_id,
          CASE (team + member) % 3
            WHEN 0 THEN 'attending'::attendance_response
            WHEN 1 THEN 'absent'::attendance_response
            ELSE 'pending'::attendance_response
          END
        )
        ON CONFLICT (tenant_id, event_id, user_id, member_id) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
END
$fixture$;
`,
    sql`
-- 各チームへowner操作相当の出欠190件を追加し、既存の9〜10件と合わせて各200件にする。
DO $fixture$
DECLARE
  team integer;
  event_number integer;
  v_team_id uuid;
  v_event_id uuid;
  v_member_id uuid;
  v_user_id varchar(128);
  v_response_id uuid;
BEGIN
  FOR team IN 1..1001 LOOP
    v_team_id := ('00000000-0000-7000-8000-' || lpad((10000 + team)::text, 12, '0'))::uuid;
    v_user_id := 'club-' || CASE WHEN team >= 1000 THEN team::text ELSE lpad(team::text, 3, '0') END || '-owner';
    PERFORM set_config('app.tenant_id', v_team_id::text, true);
    PERFORM set_config('app.user_id', v_user_id, true);
    PERFORM set_config('app.role', 'owner', true);
    FOR event_number IN 1..190 LOOP
      v_event_id := ('00000000-0000-7000-8000-' || lpad((CASE WHEN event_number = 1 THEN 7000 + team ELSE 8000000 + ((team - 1) * 199) + event_number END)::text, 12, '0'))::uuid;
      v_member_id := ('00000000-0000-7000-8000-' || lpad((20000 + ((team - 1) * 10) + 1 + ((event_number - 1) % 10))::text, 12, '0'))::uuid;
      v_response_id := ('00000000-0000-7000-8000-' || lpad((9200000 + ((team - 1) * 191) + event_number)::text, 12, '0'))::uuid;
      INSERT INTO attendance_responses (id, tenant_id, event_id, user_id, member_id, response)
      VALUES (
        v_response_id,
        v_team_id,
        v_event_id,
        v_user_id,
        v_member_id,
        CASE (team + event_number) % 3
          WHEN 0 THEN 'attending'::attendance_response
          WHEN 1 THEN 'absent'::attendance_response
          ELSE 'pending'::attendance_response
        END
      )
      ON CONFLICT (tenant_id, event_id, user_id, member_id) DO NOTHING;
    END LOOP;
    IF team % 5 = 0 THEN
      event_number := 191;
      v_event_id := ('00000000-0000-7000-8000-' || lpad((8000000 + ((team - 1) * 199) + event_number)::text, 12, '0'))::uuid;
      v_member_id := ('00000000-0000-7000-8000-' || lpad((20000 + ((team - 1) * 10) + 1 + ((event_number - 1) % 10))::text, 12, '0'))::uuid;
      v_response_id := ('00000000-0000-7000-8000-' || lpad((9200000 + ((team - 1) * 191) + event_number)::text, 12, '0'))::uuid;
      INSERT INTO attendance_responses (id, tenant_id, event_id, user_id, member_id, response)
      VALUES (v_response_id, v_team_id, v_event_id, v_user_id, v_member_id, 'pending'::attendance_response)
      ON CONFLICT (tenant_id, event_id, user_id, member_id) DO NOTHING;
    END IF;
  END LOOP;
END
$fixture$;
`,
    sql`
-- 各予定へ部員全員が回答した、実運用に近い1,002,001件の出欠トランザクション。
WITH fixture_session AS (
  SELECT set_config('app.tenant_id', '${tenantC}', true), set_config('app.user_id', 'owner-c', true), set_config('app.role', 'owner', true)
)
INSERT INTO attendance_responses
  (id, tenant_id, event_id, user_id, member_id, response, responded_at, updated_at)
SELECT
  ('00000000-0000-7000-8000-' || lpad((7200000 + ((event - 1) * 1001) + member)::text, 12, '0'))::uuid,
  '${tenantC}',
  ('00000000-0000-7000-8000-' || lpad((7100000 + event)::text, 12, '0'))::uuid,
  'owner-c',
  ('00000000-0000-7000-8000-' || lpad((220 + member)::text, 12, '0'))::uuid,
  CASE (event + member) % 3
    WHEN 0 THEN 'attending'::attendance_response
    WHEN 1 THEN 'absent'::attendance_response
    ELSE 'pending'::attendance_response
  END,
  timestamp '2026-08-01T00:00:00Z' + (event || ' days')::interval,
  timestamp '2026-08-01T00:00:00Z' + (event || ' days')::interval
FROM generate_series(1, 1001) AS events(event)
CROSS JOIN generate_series(1, 1001) AS members(member)
CROSS JOIN fixture_session
ON CONFLICT (tenant_id, event_id, user_id, member_id) DO NOTHING;
`,
    sql`
WITH fixture_session AS (
  SELECT set_config('app.tenant_id', '${tenantC}', true), set_config('app.user_id', 'guardian-c', true), set_config('app.role', 'guardian', true)
)
INSERT INTO attendance_responses (id, tenant_id, event_id, user_id, member_id, response)
SELECT '${uuid(1102)}', '${tenantC}', '${uuid(1002)}', 'guardian-c', '${uuid(210)}', 'pending'::attendance_response
FROM fixture_session
ON CONFLICT (tenant_id, event_id, user_id, member_id) DO NOTHING;
`,
    sql`
WITH fixture_session AS (
  SELECT set_config('app.tenant_id', '${tenantC}', true), set_config('app.user_id', 'owner-c', true), set_config('app.role', 'owner', true)
)
INSERT INTO attendance_responses (id, tenant_id, event_id, user_id, member_id, response, correction_reason, responded_at, updated_at)
SELECT '${uuid(1103)}', '${tenantC}', '${uuid(1003)}', 'owner-c', '${uuid(209)}', 'absent'::attendance_response, '過去予定の代理修正', '2020-02-12T00:00:00Z', '2020-02-12T00:00:00Z'
FROM fixture_session
ON CONFLICT (tenant_id, event_id, user_id, member_id) DO NOTHING;
`,
    sql`
INSERT INTO board_contacts
  (id, tenant_id, fiscal_year, role_name, role_type, assignee_user_id, line_contact, phone, contact_preference)
VALUES
  ('${uuid(1201)}', '${tenantC}', 2026, '代表', 'admin', 'owner-c', 'line://owner-c', '000-0000-0001', 'both'),
  ('${uuid(1202)}', '${tenantC}', 2026, '会計', 'staff', 'owner-c', NULL, '000-0000-0002', 'phone'),
  ('${uuid(1203)}', '${tenantC}', 2026, '連絡係', 'member', NULL, 'line://contact-c', NULL, 'line'),
  ('${uuid(1204)}', '${tenantC}', 2026, '副代表', 'admin', 'owner-c', 'line://owner-c-2', '000-0000-0003', 'line')
ON CONFLICT (id) DO NOTHING;
`,
    sql`
-- 固定3チームにも負荷試験用の役員100人ずつを用意し、ログイン確認と一覧性能を同じデータ量で検証できるようにする。
INSERT INTO board_contacts
  (id, tenant_id, fiscal_year, role_name, role_type, assignee_user_id, line_contact, phone, contact_preference)
SELECT
  ('00000000-0000-7000-8000-' || lpad((id_base + contact)::text, 12, '0'))::uuid,
  tenant_id,
  2026,
  team_code || '負荷役員' || lpad(contact::text, 3, '0'),
  CASE contact % 3 WHEN 0 THEN 'admin' WHEN 1 THEN 'staff' ELSE 'member' END,
  CASE WHEN contact % 3 = 2 THEN NULL ELSE owner_user_id END,
  CASE contact % 3 WHEN 1 THEN NULL ELSE 'line://fixed-load-board-' || team_code || '-' || contact END,
  CASE contact % 3 WHEN 0 THEN NULL ELSE '000-0000-' || lpad(contact::text, 4, '0') END,
  CASE contact % 3 WHEN 0 THEN 'line' WHEN 1 THEN 'phone' ELSE 'both' END
FROM (VALUES
  ('${tenantA}'::uuid, 'A', 'owner-a', 100, 3100000),
  ('${tenantB}'::uuid, 'B', 'owner-b', 100, 3100100),
  ('${tenantC}'::uuid, 'C', 'owner-c', 96, 3000004)
) AS fixed(tenant_id, team_code, owner_user_id, contact_count, id_base)
CROSS JOIN LATERAL generate_series(1, fixed.contact_count) AS generated(contact)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO board_contacts
  (id, tenant_id, fiscal_year, role_name, role_type, assignee_user_id, line_contact, phone, contact_preference)
SELECT
  ('00000000-0000-7000-8000-' || lpad((12000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  2026,
  CASE series % 3 WHEN 0 THEN '代表' WHEN 1 THEN '会計' ELSE '連絡係' END,
  CASE series % 3 WHEN 0 THEN 'admin' WHEN 1 THEN 'staff' ELSE 'member' END,
  'club-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END || '-owner',
  CASE series % 4 WHEN 0 THEN 'line://scale-contact-' || series WHEN 1 THEN NULL ELSE 'line://scale-contact-' || series END,
  CASE series % 4 WHEN 0 THEN NULL WHEN 1 THEN '000-0000-' || lpad(series::text, 4, '0') ELSE '000-0000-' || lpad(series::text, 4, '0') END,
  CASE series % 4 WHEN 0 THEN 'line' WHEN 1 THEN 'phone' ELSE 'both' END
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
-- 既存の代表枠1件に加えて、負荷試験用の役員99人を1,001チームへ追加し、合計100人ずつ、100,100件を用意する。
INSERT INTO board_contacts
  (id, tenant_id, fiscal_year, role_name, role_type, assignee_user_id, line_contact, phone, contact_preference)
SELECT
  ('00000000-0000-7000-8000-' || lpad((2000000 + ((team - 1) * 100) + contact)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + team)::text, 12, '0'))::uuid,
  2026,
  '負荷役員' || lpad(contact::text, 3, '0'),
  CASE contact % 3 WHEN 0 THEN 'admin' WHEN 1 THEN 'staff' ELSE 'member' END,
  'club-' || CASE WHEN team >= 1000 THEN team::text ELSE lpad(team::text, 3, '0') END || '-owner',
  CASE contact % 3 WHEN 1 THEN NULL ELSE 'line://load-board-' || team || '-' || contact END,
  CASE contact % 3 WHEN 0 THEN NULL ELSE '000-0000-' || lpad(((team - 1) * 100 + contact)::text, 6, '0') END,
  CASE contact % 3 WHEN 0 THEN 'line' WHEN 1 THEN 'phone' ELSE 'both' END
FROM generate_series(1, 1001) AS teams(team)
CROSS JOIN generate_series(1, 99) AS contacts(contact)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
VALUES
  ('${uuid(1301)}', '${tenantC}', 'owner-c', 'fixture.created', 'tenant', '${tenantC}', jsonb_build_object('scenario', 'rich-local-data')),
  ('${uuid(1302)}', '${tenantC}', 'owner-c', 'fixture.created', 'tenant', '${tenantC}', jsonb_build_object('scenario', 'basic-plan')),
  ('${uuid(1303)}', '${tenantC}', 'owner-c', 'fixture.created', 'tenant', '${tenantC}', jsonb_build_object('scenario', 'state-boundaries'))
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO promotion_runs
  (id, tenant_id, fiscal_year, status, preview_count, actor_user_id, idempotency_key, request_hash, result)
VALUES
  ('${uuid(1401)}', '${tenantC}', 2090, 'preview', 6, 'owner-c', NULL, NULL, jsonb_build_object('scenario', 'preview')),
  ('${uuid(1402)}', '${tenantC}', 2091, 'preview', 0, 'owner-c', 'fixture-failed', repeat('c', 64), jsonb_build_object('errorCode', 'PROMOTION_GRADE_LIMIT')),
  ('${uuid(1403)}', '${tenantC}', 2092, 'preview', 4, 'owner-c', 'fixture-completed', repeat('d', 64), jsonb_build_object('promotedCount', 4))
ON CONFLICT (id) DO NOTHING;
`,
    sql`UPDATE promotion_runs SET status = 'failed' WHERE id = '${uuid(1402)}' AND status = 'preview';`,
    sql`UPDATE promotion_runs SET status = 'completed', executed_at = '2026-08-25T00:00:00Z' WHERE id = '${uuid(1403)}' AND status = 'preview';`,
    sql`
INSERT INTO purchase_orders (id, tenant_id, title, deadline, status)
VALUES
  ('${uuid(1501)}', '${tenantC}', '春季ユニフォーム共同購入', '2099-04-01T23:59:00Z', 'open'),
  ('${uuid(1502)}', '${tenantC}', '冬季用品（締切済み）', '2026-01-15T23:59:00Z', 'open'),
  ('${uuid(1503)}', '${tenantC}', '昨年度用品（完了）', '2025-01-15T23:59:00Z', 'open'),
  ('${uuid(1504)}', '${tenantC}', 'Bチーム備品', '2099-04-01T23:59:00Z', 'open')
ON CONFLICT (id) DO NOTHING;
`,
    sql`UPDATE purchase_orders SET status = 'closed' WHERE id = '${uuid(1502)}' AND status = 'open';`,
    sql`UPDATE purchase_orders SET status = 'closed' WHERE id = '${uuid(1503)}' AND status = 'open';`,
    sql`UPDATE purchase_orders SET status = 'completed' WHERE id = '${uuid(1503)}' AND status = 'closed';`,
    sql`
INSERT INTO order_products (id, tenant_id, order_id, name, unit_price, options, requires_back_number, requires_back_name)
VALUES
  ('${uuid(1511)}', '${tenantC}', '${uuid(1501)}', '練習シャツ', 3000, jsonb_build_array(jsonb_build_object('key', 'size', 'values', jsonb_build_array('S', 'M', 'L'))), true, false),
  ('${uuid(1512)}', '${tenantC}', '${uuid(1501)}', '応援タオル', 1200, '[]'::jsonb, false, false),
  ('${uuid(1513)}', '${tenantC}', '${uuid(1502)}', '冬用ジャケット', 8000, '[]'::jsonb, false, true),
  ('${uuid(1514)}', '${tenantC}', '${uuid(1504)}', 'Bチームバッグ', 4500, '[]'::jsonb, false, false)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
WITH inserted_entry AS (
  INSERT INTO order_entries (id, tenant_id, order_id, orderer_user_id, orderer_name, member_id, total_amount, payment_status)
  VALUES ('${uuid(1521)}', '${tenantC}', '${uuid(1501)}', 'guardian-c', 'テスト保護者C', '${uuid(209)}', 4200, 'unpaid')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO order_lines
  (id, tenant_id, order_entry_id, product_id, product_name, unit_price, quantity, selected_options, back_number, back_name, amount)
SELECT line.id, '${tenantC}', '${uuid(1521)}', line.product_id, line.product_name, line.unit_price, 1, line.selected_options, line.back_number, line.back_name, line.amount
FROM inserted_entry
CROSS JOIN (VALUES
  ('${uuid(1531)}'::uuid, '${uuid(1511)}'::uuid, '練習シャツ', 3000::bigint, jsonb_build_object('size', 'M'), '12', NULL::text, 3000::bigint),
  ('${uuid(1532)}'::uuid, '${uuid(1512)}'::uuid, '応援タオル', 1200::bigint, '{}'::jsonb, NULL::text, NULL::text, 1200::bigint)
) AS line(id, product_id, product_name, unit_price, selected_options, back_number, back_name, amount)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
WITH inserted_entry AS (
  INSERT INTO order_entries
    (id, tenant_id, order_id, orderer_user_id, orderer_name, member_id, total_amount, payment_status, payment_confirmed_at, payment_confirmed_by)
  VALUES ('${uuid(1522)}', '${tenantC}', '${uuid(1501)}', 'guardian-c', 'テスト保護者C2', '${uuid(210)}', 1200, 'paid', '2026-08-25T12:00:00Z', 'owner-c')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO order_lines
  (id, tenant_id, order_entry_id, product_id, product_name, unit_price, quantity, selected_options, back_number, back_name, amount)
SELECT '${uuid(1533)}', '${tenantC}', '${uuid(1522)}', '${uuid(1512)}', '応援タオル', 1200, 1, '{}'::jsonb, NULL, NULL, 1200
FROM inserted_entry
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO order_idempotency_keys
  (id, tenant_id, actor_user_id, idempotency_key, request_hash, resource_type, resource_id)
VALUES ('${uuid(1541)}', '${tenantC}', 'guardian-c', 'fixture-order-entry-c', repeat('e', 64), 'order-entry', '${uuid(1521)}')
ON CONFLICT (tenant_id, actor_user_id, idempotency_key) DO NOTHING;
`,
    sql`
INSERT INTO announcements (id, tenant_id, author_user_id, title, body, status, published_at)
VALUES
  ('${uuid(1601)}', '${tenantC}', 'owner-c', '新年度のお知らせ', '新年度の活動予定を確認してください。', 'published', '2026-08-25T09:00:00Z'),
  ('${uuid(1602)}', '${tenantC}', 'owner-c', '過去のお知らせ', '保存済みの過去資料です。', 'published', '2025-04-01T09:00:00Z'),
  ('${uuid(1603)}', '${tenantC}', 'owner-c', 'Bチーム連絡', 'Bチームの連絡です。', 'published', '2026-08-25T10:00:00Z')
ON CONFLICT (id) DO NOTHING;
`,
    sql`UPDATE announcements SET status = 'archived' WHERE id = '${uuid(1602)}' AND status = 'published';`,
    sql`
INSERT INTO announcements (id, tenant_id, author_user_id, title, body, status, published_at)
SELECT
  ('00000000-0000-7000-8000-' || lpad((8000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  'club-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END || '-owner',
  'チーム連絡' || lpad(series::text, 4, '0'),
  'チーム活動の連絡事項です。',
  'published'::announcement_status,
  timestamp '2026-05-01T09:00:00Z' + (series || ' days')::interval
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
-- 負荷用テナントCに、ユーザーが掲載した公開回覧を1,001件用意する。
INSERT INTO announcements (id, tenant_id, author_user_id, title, body, status, published_at)
SELECT
  ('00000000-0000-7000-8000-' || lpad((1650 + series)::text, 12, '0'))::uuid,
  '${tenantC}',
  'owner-c',
  '負荷検証回覧' || lpad(series::text, 4, '0'),
  '負荷検証用の回覧本文です。',
  'published'::announcement_status,
  timestamp '2026-01-01T00:00:00Z' + (series || ' days')::interval
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO announcement_attachments (tenant_id, announcement_id, attachment_id, position, media_type, byte_size)
VALUES ('${tenantC}', '${uuid(1601)}', '${uuid(2001)}', 1, 'application/pdf', 1024)
ON CONFLICT (tenant_id, announcement_id, attachment_id) DO NOTHING;
`,
    sql`
INSERT INTO announcement_reads (tenant_id, announcement_id, user_id, read_at)
VALUES
  ('${tenantC}', '${uuid(1601)}', 'guardian-c', '2026-08-25T10:00:00Z'),
  ('${tenantC}', '${uuid(1601)}', 'owner-c', '2026-08-25T09:30:00Z')
ON CONFLICT (tenant_id, announcement_id, user_id) DO NOTHING;
`,
    sql`
INSERT INTO announcement_reads (tenant_id, announcement_id, user_id, read_at)
SELECT
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((8000 + series)::text, 12, '0'))::uuid,
  'club-' || lpad(series::text, 4, '0') || '-member-01-parent-1',
  timestamp '2026-05-02T09:00:00Z' + (series || ' days')::interval
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (tenant_id, announcement_id, user_id) DO NOTHING;
`,
    sql`
INSERT INTO announcement_reads (tenant_id, announcement_id, user_id, read_at)
SELECT
  '${tenantC}',
  ('00000000-0000-7000-8000-' || lpad((1650 + series)::text, 12, '0'))::uuid,
  'c-load-member-' || lpad(series::text, 4, '0') || '-parent-1',
  timestamp '2026-08-01T09:00:00Z' + (series || ' days')::interval
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (tenant_id, announcement_id, user_id) DO NOTHING;
`,
    sql`
INSERT INTO line_connections (tenant_id, group_id, status, connected_at, updated_at)
VALUES
  ('${tenantC}', 'Ctest-team-c', 'connected', '2026-08-25T00:00:00Z', '2026-08-25T00:00:00Z')
ON CONFLICT (tenant_id) DO NOTHING;
`,
    sql`
INSERT INTO line_connections (tenant_id, group_id, status, connected_at, updated_at)
SELECT
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  CASE WHEN series = 1001 THEN NULL ELSE 'Cscale-team-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END END,
  CASE WHEN series = 1001 THEN 'disconnected'::line_connection_status ELSE 'connected'::line_connection_status END,
  CASE WHEN series = 1001 THEN NULL ELSE '2026-08-25T00:00:00Z'::timestamptz END,
  '2026-08-25T00:00:00Z'
FROM generate_series(1, 1001) AS generated(series)
WHERE series = 1001
   OR NOT EXISTS (
     SELECT 1 FROM line_connections existing
     WHERE existing.group_id = 'Cscale-team-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END
   )
ON CONFLICT (tenant_id) DO NOTHING;
`,
    sql`
INSERT INTO line_notification_queue
  (id, tenant_id, group_id, created_by_user_id, source_type, source_id, title, body, deep_link, status, attempts)
VALUES
  ('${uuid(1701)}', '${tenantC}', 'Ctest-team-c', 'owner-c', 'event', '${uuid(1001)}', '予定のお知らせ', '予定の詳細を確認してください。', 'http://localhost:5173/events/${uuid(1001)}', 'pending', 0),
  ('${uuid(1702)}', '${tenantC}', 'Ctest-team-c', 'owner-c', 'bulletin', '${uuid(1601)}', '回覧のお知らせ', '回覧の詳細を確認してください。', 'http://localhost:5173/bulletins/${uuid(1601)}', 'pending', 0),
  ('${uuid(1703)}', '${tenantC}', 'Ctest-team-c', 'owner-c', 'deadline', '${uuid(1002)}', '締切のお知らせ', '出欠締切を確認してください。', 'http://localhost:5173/events/${uuid(1002)}', 'pending', 0)
ON CONFLICT (id) DO NOTHING;
`,
    sql`UPDATE line_notification_queue SET status = 'sending', attempts = 1 WHERE id = '${uuid(1702)}' AND status = 'pending';`,
    sql`UPDATE line_notification_queue SET status = 'sent', provider_message_id = 'provider-fixture-1702', sent_at = '2026-08-25T00:05:00Z' WHERE id = '${uuid(1702)}' AND status = 'sending';`,
    sql`UPDATE line_notification_queue SET status = 'sending', attempts = 1 WHERE id = '${uuid(1703)}' AND status = 'pending';`,
    sql`UPDATE line_notification_queue SET status = 'failed', attempts = 1, next_retry_at = '2099-01-01T00:00:00Z', last_error = 'provider fixture failure' WHERE id = '${uuid(1703)}' AND status = 'sending';`,
    sql`
INSERT INTO line_webhook_receipts (tenant_id, group_id, webhook_event_id, received_at)
VALUES
  ('${tenantC}', 'Ctest-team-c', 'webhook-fixture-1', '2026-08-25T00:10:00Z'),
  ('${tenantC}', 'Ctest-team-c', 'webhook-fixture-2', '2026-08-25T00:11:00Z')
ON CONFLICT (group_id, webhook_event_id) DO NOTHING;
`,
    sql`
INSERT INTO line_delivery_outbox
  (id, tenant_id, actor_user_id, source_type, source_id, destination, title, body, deep_link, status, attempt, next_retry_at, provider_message_id, sent_at, idempotency_key, payload_hash, connection_connected_at)
VALUES
  ('${uuid(1751)}', '${tenantC}', 'owner-c', 'event', '${uuid(1001)}', 'Ctest-team-c', '予定通知', '予定を確認してください。', 'http://localhost:5173/events/${uuid(1001)}', 'pending', 0, NULL, NULL, NULL, 'fixture-line-1751', encode(digest(concat_ws(E'\\x1f', 'Ctest-team-c', '予定通知', '予定を確認してください。', 'http://localhost:5173/events/${uuid(1001)}'), 'sha256'), 'hex'), '2026-08-25T00:00:00Z'),
  ('${uuid(1752)}', '${tenantC}', 'owner-c', 'bulletin', '${uuid(1601)}', 'Ctest-team-c', '回覧通知', '回覧を確認してください。', 'http://localhost:5173/bulletins/${uuid(1601)}', 'sent', 1, NULL, 'provider-fixture-1752', '2026-08-25T00:20:00Z', 'fixture-line-1752', encode(digest(concat_ws(E'\\x1f', 'Ctest-team-c', '回覧通知', '回覧を確認してください。', 'http://localhost:5173/bulletins/${uuid(1601)}'), 'sha256'), 'hex'), '2026-08-25T00:00:00Z'),
  ('${uuid(1753)}', '${tenantC}', 'owner-c', 'event', '${uuid(1002)}', 'Ctest-team-c', '試合通知', '試合を確認してください。', 'http://localhost:5173/events/${uuid(1002)}', 'failed', 2, '2099-01-01T00:00:00Z', NULL, NULL, 'fixture-line-1753', encode(digest(concat_ws(E'\\x1f', 'Ctest-team-c', '試合通知', '試合を確認してください。', 'http://localhost:5173/events/${uuid(1002)}'), 'sha256'), 'hex'), '2026-08-25T00:00:00Z'),
  ('${uuid(1754)}', '${tenantC}', 'owner-c', 'event', '${uuid(1006)}', 'Ctest-team-c', 'C通知（未契約）', '契約無効状態の確認用です。', 'http://localhost:5173/events/${uuid(1006)}', 'pending', 0, NULL, NULL, NULL, 'fixture-line-1754', encode(digest(concat_ws(E'\\x1f', 'Ctest-team-c', 'C通知（未契約）', '契約無効状態の確認用です。', 'http://localhost:5173/events/${uuid(1006)}'), 'sha256'), 'hex'), '2026-08-25T00:00:00Z')
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO line_delivery_outbox
  (id, tenant_id, actor_user_id, source_type, source_id, destination, title, body, deep_link, status, attempt, next_retry_at, idempotency_key, payload_hash, connection_connected_at)
SELECT
  ('00000000-0000-7000-8000-' || lpad((100000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  'club-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END || '-owner',
  'event',
  ('00000000-0000-7000-8000-' || lpad((7000 + series)::text, 12, '0')),
  'Cscale-team-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END,
  'チーム活動通知',
  '予定を確認してください。',
  'http://localhost:5173/events/' || ('00000000-0000-7000-8000-' || lpad((7000 + series)::text, 12, '0')),
  'pending',
  0,
  '2099-01-01T00:00:00Z',
  'fixture-scale-line-' || series,
  encode(digest(concat_ws(E'\\x1f', 'Cscale-team-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END, 'チーム活動通知', '予定を確認してください。', 'http://localhost:5173/events/' || ('00000000-0000-7000-8000-' || lpad((7000 + series)::text, 12, '0'))), 'sha256'), 'hex'),
  '2026-08-25T00:00:00Z'
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
UPDATE line_delivery_outbox
SET status = 'sending', attempt = 1,
    attempt_token = ('00000000-0000-7000-8000-' || lpad((410000 + right(id::text, 12)::bigint)::text, 12, '0'))::uuid,
    lease_expires_at = timestamp '2099-01-01T00:00:00Z'
WHERE id BETWEEN '00000000-0000-7000-8000-000000100001'::uuid AND '00000000-0000-7000-8000-000000101001'::uuid
  AND right(id::text, 12)::bigint % 5 IN (1, 2, 3, 4)
  AND status = 'pending';
`,
    sql`
UPDATE line_delivery_outbox
SET status = 'sent', provider_message_id = 'provider-scale-' || right(id::text, 4), sent_at = timestamp '2026-08-20T00:00:00Z', lease_expires_at = NULL
WHERE id BETWEEN '00000000-0000-7000-8000-000000100001'::uuid AND '00000000-0000-7000-8000-000000101001'::uuid
  AND right(id::text, 12)::bigint % 5 = 1
  AND status = 'sending';
`,
    sql`
UPDATE line_delivery_outbox
SET status = 'failed', last_error_code = 'FIXTURE_PROVIDER', next_retry_at = timestamp '2099-01-02T00:00:00Z', lease_expires_at = NULL
WHERE id BETWEEN '00000000-0000-7000-8000-000000100001'::uuid AND '00000000-0000-7000-8000-000000101001'::uuid
  AND right(id::text, 12)::bigint % 5 IN (2, 4)
  AND status = 'sending';
`,
    sql`
INSERT INTO ride_plans
  (id, tenant_id, title, departure_at, pickup_maps_url, destination_maps_url, status)
VALUES
  ('${uuid(1801)}', '${tenantC}', '試合送迎（確定済み）', '2099-02-08T07:00:00Z', NULL, NULL, 'draft'),
  ('${uuid(1802)}', '${tenantC}', '練習送迎（受付中）', '2099-02-15T08:00:00Z', NULL, NULL, 'draft'),
  ('${uuid(1803)}', '${tenantC}', 'Bチーム送迎（未作成）', '2099-02-16T08:00:00Z', NULL, NULL, 'draft')
ON CONFLICT (id) DO NOTHING;
`,
    sql`UPDATE ride_plans SET status = 'open' WHERE id IN ('${uuid(1801)}', '${uuid(1802)}') AND status = 'draft';`,
    sql`
INSERT INTO ride_offers (id, tenant_id, plan_id, driver_user_id, capacity, status)
SELECT fixture.id, fixture.tenant_id, fixture.plan_id, fixture.driver_user_id, fixture.capacity, fixture.status
FROM (VALUES
  ('${uuid(1811)}'::uuid, '${tenantC}'::uuid, '${uuid(1801)}'::uuid, 'owner-c'::varchar, 4, 'open'::ride_offer_status),
  ('${uuid(1812)}'::uuid, '${tenantC}'::uuid, '${uuid(1802)}'::uuid, 'owner-c'::varchar, 3, 'open'::ride_offer_status)
) AS fixture(id, tenant_id, plan_id, driver_user_id, capacity, status)
WHERE NOT EXISTS (SELECT 1 FROM ride_offers existing WHERE existing.id = fixture.id)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO ride_requests (id, tenant_id, plan_id, member_id, requester_user_id, passenger_count, status)
SELECT fixture.id, fixture.tenant_id, fixture.plan_id, fixture.member_id, fixture.requester_user_id, fixture.passenger_count, fixture.status
FROM (VALUES
  ('${uuid(1821)}'::uuid, '${tenantC}'::uuid, '${uuid(1801)}'::uuid, '${uuid(209)}'::uuid, 'guardian-c'::varchar, 2, 'pending'::ride_request_status),
  ('${uuid(1822)}'::uuid, '${tenantC}'::uuid, '${uuid(1802)}'::uuid, '${uuid(210)}'::uuid, 'guardian-c'::varchar, 1, 'pending'::ride_request_status)
) AS fixture(id, tenant_id, plan_id, member_id, requester_user_id, passenger_count, status)
WHERE NOT EXISTS (SELECT 1 FROM ride_requests existing WHERE existing.id = fixture.id)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO ride_assignments (id, tenant_id, plan_id, request_id, offer_id, passenger_count)
SELECT '${uuid(1831)}', '${tenantC}', '${uuid(1801)}', '${uuid(1821)}', '${uuid(1811)}', 2
WHERE NOT EXISTS (SELECT 1 FROM ride_assignments existing WHERE existing.id = '${uuid(1831)}')
ON CONFLICT (id) DO NOTHING;
`,
    sql`
UPDATE tenant_memberships tm
SET display_name = '送迎担当 ' || tm.user_id
FROM ride_offers ro
WHERE ro.tenant_id = tm.tenant_id
  AND ro.driver_user_id = tm.user_id
  AND ro.id IN ('${uuid(1811)}'::uuid, '${uuid(1812)}'::uuid)
  AND tm.status = 'active'::membership_status
  AND NOT EXISTS (
    SELECT 1
      FROM ride_offers finalized_ro
      JOIN ride_assignments finalized_a
        ON finalized_a.tenant_id = finalized_ro.tenant_id
       AND finalized_a.plan_id = finalized_ro.plan_id
       AND finalized_a.offer_id = finalized_ro.id
      JOIN ride_plans finalized_rp
        ON finalized_rp.tenant_id = finalized_a.tenant_id
       AND finalized_rp.id = finalized_a.plan_id
     WHERE finalized_ro.tenant_id = tm.tenant_id
       AND finalized_ro.driver_user_id = tm.user_id
       AND finalized_rp.status = 'finalized'::ride_plan_status
  )
  AND NULLIF(BTRIM(tm.display_name), '') IS NULL;
`,
    sql`UPDATE ride_requests SET status = 'assigned' WHERE id = '${uuid(1821)}' AND status = 'pending';`,
    sql`UPDATE ride_requests SET status = 'unassigned' WHERE id = '${uuid(1822)}' AND status = 'pending';`,
    sql`UPDATE ride_offers SET status = 'cancelled' WHERE id = '${uuid(1812)}' AND status = 'open';`,
    sql`UPDATE ride_plans SET status = 'closed' WHERE id = '${uuid(1801)}' AND status = 'open';`,
    sql`UPDATE ride_plans SET status = 'finalized' WHERE id = '${uuid(1801)}' AND status = 'closed';`,
  ];

  statements.push(
    sql`
INSERT INTO tenant_feature_flags
  (tenant_id, feature_key, enabled, source, changed_by_user_id, reason, starts_at, ends_at)
SELECT
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  CASE series % 4
    WHEN 0 THEN 'members'
    WHEN 1 THEN 'events-attendance'
    WHEN 2 THEN 'bulletin-board'
    ELSE 'line-notifications'
  END,
  series % 4 <> 0,
  CASE series % 3 WHEN 0 THEN 'billing'::feature_flag_source WHEN 1 THEN 'admin'::feature_flag_source ELSE 'operator'::feature_flag_source END,
  'club-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END || '-owner',
  CASE series % 3 WHEN 0 THEN '契約プラン由来' WHEN 1 THEN '管理者による有効化' ELSE '運用者による停止' END,
  timestamp '2026-01-01T00:00:00Z' + (series % 12 || ' months')::interval,
  CASE WHEN series % 7 = 0 THEN timestamp '2027-01-01T00:00:00Z' ELSE NULL END
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (tenant_id, feature_key) DO NOTHING;
`,
    sql`
INSERT INTO auth_identities (id, user_id, provider, provider_subject, revoked_at)
SELECT
  ('00000000-0000-7000-8000-' || lpad((300000 + series)::text, 12, '0'))::uuid,
  'club-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END || '-owner',
  CASE WHEN series % 2 = 0 THEN 'google'::auth_provider ELSE 'line'::auth_provider END,
  'scale-provider-' || lpad(series::text, 4, '0'),
  CASE WHEN series % 7 = 0 THEN timestamp '2026-08-01T00:00:00Z' ELSE NULL END
FROM generate_series(1, 1001) AS generated(series)
WHERE NOT EXISTS (
  SELECT 1 FROM auth_identities existing
  WHERE existing.id = ('00000000-0000-7000-8000-' || lpad((300000 + series)::text, 12, '0'))::uuid
     OR (existing.user_id = 'club-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END || '-owner'
         AND existing.provider = CASE WHEN series % 2 = 0 THEN 'google'::auth_provider ELSE 'line'::auth_provider END)
)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO auth_invitations
  (id, tenant_id, member_id, role, relationship, token_hash, invited_by_user_id, status, expires_at, accepted_at, accepted_by_user_id, revoked_at, created_at, updated_at)
SELECT
  ('00000000-0000-7000-8000-' || lpad((310000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((20000 + ((series - 1) * 10) + 1)::text, 12, '0'))::uuid,
  'guardian'::role,
  CASE WHEN series % 2 = 0 THEN '父' ELSE '母' END,
  lpad(to_hex(series), 64, '0'),
  'club-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END || '-owner',
  CASE series % 4 WHEN 0 THEN 'pending'::auth_invitation_status WHEN 1 THEN 'accepted'::auth_invitation_status WHEN 2 THEN 'expired'::auth_invitation_status ELSE 'revoked'::auth_invitation_status END,
  CASE WHEN series % 4 = 2 THEN timestamp '2026-01-01T00:00:00Z' ELSE timestamp '2099-01-01T00:00:00Z' END,
  CASE WHEN series % 4 = 1 THEN timestamp '2026-08-02T00:00:00Z' ELSE NULL END,
  CASE WHEN series % 4 = 1 THEN 'club-' || lpad(series::text, 4, '0') || '-member-01-parent-2' ELSE NULL END,
  CASE WHEN series % 4 = 3 THEN timestamp '2026-08-02T00:00:00Z' ELSE NULL END,
  CASE WHEN series % 4 = 2 THEN timestamp '2025-12-01T00:00:00Z' ELSE timestamp '2026-08-01T00:00:00Z' END,
  CASE WHEN series % 4 = 2 THEN timestamp '2025-12-01T00:00:00Z' ELSE timestamp '2026-08-02T00:00:00Z' END
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
SELECT
  ('00000000-0000-7000-8000-' || lpad((320000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  'club-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END || '-owner',
  CASE series % 4 WHEN 0 THEN 'member.created' WHEN 1 THEN 'event.updated' WHEN 2 THEN 'announcement.published' ELSE 'line.delivery.failed' END,
  CASE series % 4 WHEN 0 THEN 'member' WHEN 1 THEN 'event' WHEN 2 THEN 'announcement' ELSE 'line_delivery' END,
  CASE series % 4 WHEN 0 THEN ('00000000-0000-7000-8000-' || lpad((20000 + ((series - 1) * 10) + 1)::text, 12, '0'))::uuid WHEN 1 THEN ('00000000-0000-7000-8000-' || lpad((7000 + series)::text, 12, '0'))::uuid WHEN 2 THEN ('00000000-0000-7000-8000-' || lpad((8000 + series)::text, 12, '0'))::uuid ELSE NULL END,
  jsonb_build_object('fixture', 'scale', 'sequence', series, 'hasSensitiveData', false)
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO promotion_runs
  (id, tenant_id, fiscal_year, status, preview_count, actor_user_id, idempotency_key, request_hash, result)
SELECT
  ('00000000-0000-7000-8000-' || lpad((330000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  2000 + (series % 101),
  'preview'::promotion_run_status,
  series % 11,
  'club-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END || '-owner',
  'scale-promotion-' || lpad(series::text, 4, '0'),
  lpad(to_hex(series), 64, '0'),
  jsonb_build_object('fixture', 'scale', 'candidateCount', series % 11)
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
UPDATE promotion_runs
SET status = 'failed', result = jsonb_build_object('fixture', 'scale', 'errorCode', 'PROMOTION_GRADE_LIMIT')
WHERE id BETWEEN '00000000-0000-7000-8000-000000330001'::uuid AND '00000000-0000-7000-8000-000000331001'::uuid
  AND right(id::text, 12)::bigint % 3 = 1
  AND status = 'preview';
`,
    sql`
UPDATE promotion_runs
SET status = 'completed', executed_at = timestamp '2026-08-10T00:00:00Z' + (right(id::text, 12)::bigint % 30 || ' days')::interval
WHERE id BETWEEN '00000000-0000-7000-8000-000000330001'::uuid AND '00000000-0000-7000-8000-000000331001'::uuid
  AND right(id::text, 12)::bigint % 3 = 2
  AND status = 'preview';
`,
    sql`
INSERT INTO attachments
  (id, tenant_id, owner_user_id, object_key, media_type, byte_size, expires_at)
SELECT
  ('00000000-0000-7000-8000-' || lpad((340000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  'club-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END || '-owner',
  'scale/' || series || '/primary-' || series,
  CASE series % 3 WHEN 0 THEN 'application/pdf' WHEN 1 THEN 'image/png' ELSE 'image/jpeg' END,
  1024 + (series % 32) * 1024,
  timestamp '2099-12-31T23:59:00Z'
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO attachments
  (id, tenant_id, owner_user_id, object_key, media_type, byte_size, expires_at)
SELECT
  ('00000000-0000-7000-8000-' || lpad((342000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  'club-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END || '-owner',
  'scale/' || series || '/secondary-' || series,
  CASE series % 3 WHEN 0 THEN 'application/pdf' WHEN 1 THEN 'image/png' ELSE 'image/jpeg' END,
  2048 + (series % 64) * 512,
  CASE WHEN series % 6 = 0 THEN timestamp '2026-08-20T00:00:00Z' ELSE timestamp '2099-12-31T23:59:00Z' END
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
UPDATE attachments
SET status = 'available', sha256 = repeat('a', 64), available_at = timestamp '2026-08-20T00:00:00Z' + (right(id::text, 12)::bigint % 30 || ' days')::interval, complete_attempts = 1
WHERE id BETWEEN '00000000-0000-7000-8000-000000340001'::uuid AND '00000000-0000-7000-8000-000000341001'::uuid
  AND status = 'uploaded';
`,
    sql`
UPDATE attachments
SET status = 'rejected', cleanup_attempts = 1
WHERE id BETWEEN '00000000-0000-7000-8000-000000342001'::uuid AND '00000000-0000-7000-8000-000000343001'::uuid
  AND right(id::text, 12)::bigint % 4 = 1
  AND status = 'uploaded';
`,
    sql`
UPDATE attachments
SET status = 'available', sha256 = repeat('b', 64), available_at = timestamp '2026-08-21T00:00:00Z' + (right(id::text, 12)::bigint % 20 || ' days')::interval, complete_attempts = 1
WHERE id BETWEEN '00000000-0000-7000-8000-000000342001'::uuid AND '00000000-0000-7000-8000-000000343001'::uuid
  AND right(id::text, 12)::bigint % 4 IN (2, 3)
  AND status = 'uploaded';
`,
    sql`
UPDATE attachments
SET status = 'deleted', deleted_at = timestamp '2026-08-25T00:00:00Z', cleanup_attempts = 2
WHERE id BETWEEN '00000000-0000-7000-8000-000000342001'::uuid AND '00000000-0000-7000-8000-000000343001'::uuid
  AND right(id::text, 12)::bigint % 4 = 3
  AND status = 'available';
`,
    sql`
INSERT INTO purchase_orders (id, tenant_id, title, deadline, status)
SELECT
  ('00000000-0000-7000-8000-' || lpad((360000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  CASE series % 3 WHEN 0 THEN 'ユニフォーム共同購入' WHEN 1 THEN '大会用備品' ELSE '冬季用品' END || lpad(series::text, 4, '0'),
  timestamp '2099-06-01T23:59:00Z' + (series || ' days')::interval,
  'open'::purchase_order_status
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
UPDATE purchase_orders
SET status = 'closed'
WHERE id BETWEEN '00000000-0000-7000-8000-000000360001'::uuid AND '00000000-0000-7000-8000-000000361001'::uuid
  AND right(id::text, 12)::bigint % 3 IN (0, 1)
  AND status = 'open';
`,
    sql`
UPDATE purchase_orders
SET status = 'completed'
WHERE id BETWEEN '00000000-0000-7000-8000-000000360001'::uuid AND '00000000-0000-7000-8000-000000361001'::uuid
  AND right(id::text, 12)::bigint % 3 = 0
  AND status = 'closed';
`,
    sql`
INSERT INTO order_products (id, tenant_id, order_id, name, unit_price, options, requires_back_number, requires_back_name)
SELECT
  ('00000000-0000-7000-8000-' || lpad((370000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((360000 + series)::text, 12, '0'))::uuid,
  CASE series % 3 WHEN 0 THEN '練習シャツ' WHEN 1 THEN '応援タオル' ELSE 'チームバッグ' END || lpad(series::text, 4, '0'),
  (1000 + (series % 6) * 250)::bigint,
  CASE series % 3 WHEN 0 THEN jsonb_build_array(jsonb_build_object('key', 'size', 'values', jsonb_build_array('S', 'M', 'L'))) WHEN 1 THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('key', 'color', 'values', jsonb_build_array('red', 'blue'))) END,
  series % 3 = 0,
  series % 4 = 0
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
WITH source AS (
  SELECT
    series,
    ('00000000-0000-7000-8000-' || lpad((380000 + series)::text, 12, '0'))::uuid AS entry_id,
    ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid AS tenant_id,
    ('00000000-0000-7000-8000-' || lpad((360000 + series)::text, 12, '0'))::uuid AS order_id,
    ('00000000-0000-7000-8000-' || lpad((20000 + ((series - 1) * 10) + 1)::text, 12, '0'))::uuid AS member_id,
    (1000 + (series % 6) * 250)::bigint AS total_amount
  FROM generate_series(1, 1001) AS generated(series)
), inserted_entries AS (
  INSERT INTO order_entries
    (id, tenant_id, order_id, orderer_user_id, orderer_name, member_id, total_amount, payment_status, payment_confirmed_at, payment_confirmed_by)
  SELECT
    entry_id,
    tenant_id,
    order_id,
    'club-' || lpad(series::text, 4, '0') || '-member-01-parent-1',
    '大量検証保護者' || lpad(series::text, 4, '0'),
    member_id,
    total_amount,
    CASE WHEN series % 2 = 0 THEN 'paid'::payment_status ELSE 'unpaid'::payment_status END,
    CASE WHEN series % 2 = 0 THEN timestamp '2026-08-15T00:00:00Z' ELSE NULL END,
    CASE WHEN series % 2 = 0 THEN 'club-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END || '-owner' ELSE NULL END
  FROM source
  WHERE NOT EXISTS (SELECT 1 FROM order_entries existing WHERE existing.id = source.entry_id)
    AND EXISTS (
      SELECT 1 FROM purchase_orders order_header
      WHERE order_header.id = source.order_id
        AND order_header.tenant_id = source.tenant_id
        AND order_header.status = 'open'
    )
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO order_lines
  (id, tenant_id, order_entry_id, product_id, product_name, unit_price, quantity, selected_options, back_number, back_name, amount)
SELECT
  ('00000000-0000-7000-8000-' || lpad((390000 + source.series)::text, 12, '0'))::uuid,
  source.tenant_id,
  source.entry_id,
  ('00000000-0000-7000-8000-' || lpad((370000 + source.series)::text, 12, '0'))::uuid,
  CASE source.series % 3 WHEN 0 THEN '練習シャツ' WHEN 1 THEN '応援タオル' ELSE 'チームバッグ' END || lpad(source.series::text, 4, '0'),
  source.total_amount,
  1,
  CASE source.series % 3 WHEN 0 THEN jsonb_build_object('size', 'M') WHEN 1 THEN '{}'::jsonb ELSE jsonb_build_object('color', 'red') END,
  CASE WHEN source.series % 3 = 0 THEN lpad((source.series % 99 + 1)::text, 2, '0') ELSE NULL END,
  CASE WHEN source.series % 4 = 0 THEN '大量検証' || source.series ELSE NULL END,
  source.total_amount
FROM source
JOIN inserted_entries inserted ON inserted.id = source.entry_id
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO order_idempotency_keys
  (id, tenant_id, actor_user_id, idempotency_key, request_hash, resource_type, resource_id)
SELECT
  ('00000000-0000-7000-8000-' || lpad((400000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  'club-' || lpad(series::text, 4, '0') || '-member-01-parent-1',
  'scale-order-' || lpad(series::text, 4, '0'),
  lpad(to_hex(series), 64, '0'),
  'order-entry',
  ('00000000-0000-7000-8000-' || lpad((380000 + series)::text, 12, '0'))::uuid
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (tenant_id, actor_user_id, idempotency_key) DO NOTHING;
`,
    sql`
WITH source AS (
  SELECT
    series,
    ((series - 1) % 334) * 3 + 2 AS order_series,
    ('00000000-0000-7000-8000-' || lpad((382000 + series)::text, 12, '0'))::uuid AS entry_id
  FROM generate_series(1, 1001) AS generated(series)
), inserted_entries AS (
  INSERT INTO order_entries
    (id, tenant_id, order_id, orderer_user_id, orderer_name, member_id, total_amount, payment_status, payment_confirmed_at, payment_confirmed_by)
  SELECT
    source.entry_id,
    ('00000000-0000-7000-8000-' || lpad((10000 + source.order_series)::text, 12, '0'))::uuid,
    ('00000000-0000-7000-8000-' || lpad((360000 + source.order_series)::text, 12, '0'))::uuid,
    'club-' || CASE WHEN source.order_series >= 1000 THEN source.order_series::text ELSE lpad(source.order_series::text, 3, '0') END || '-member-' || lpad(((source.series % 7) + 1)::text, 2, '0') || '-parent-2',
    '追加検証保護者' || lpad(source.series::text, 4, '0'),
    ('00000000-0000-7000-8000-' || lpad((20000 + ((source.order_series - 1) * 10) + ((source.series % 7) + 1))::text, 12, '0'))::uuid,
    (1000 + (source.order_series % 6) * 250)::bigint,
    CASE WHEN source.series % 2 = 0 THEN 'paid'::payment_status ELSE 'unpaid'::payment_status END,
    CASE WHEN source.series % 2 = 0 THEN timestamp '2026-08-16T00:00:00Z' ELSE NULL END,
    CASE WHEN source.series % 2 = 0 THEN 'club-' || CASE WHEN source.order_series >= 1000 THEN source.order_series::text ELSE lpad(source.order_series::text, 3, '0') END || '-owner' ELSE NULL END
  FROM source
  WHERE NOT EXISTS (SELECT 1 FROM order_entries existing WHERE existing.id = source.entry_id)
    AND EXISTS (
      SELECT 1 FROM purchase_orders order_header
      WHERE order_header.id = ('00000000-0000-7000-8000-' || lpad((360000 + source.order_series)::text, 12, '0'))::uuid
        AND order_header.tenant_id = ('00000000-0000-7000-8000-' || lpad((10000 + source.order_series)::text, 12, '0'))::uuid
        AND order_header.status = 'open'
    )
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO order_lines
  (id, tenant_id, order_entry_id, product_id, product_name, unit_price, quantity, selected_options, back_number, back_name, amount)
SELECT
  ('00000000-0000-7000-8000-' || lpad((392000 + source.series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + source.order_series)::text, 12, '0'))::uuid,
  source.entry_id,
  ('00000000-0000-7000-8000-' || lpad((370000 + source.order_series)::text, 12, '0'))::uuid,
  CASE source.order_series % 3 WHEN 0 THEN '練習シャツ' WHEN 1 THEN '応援タオル' ELSE 'チームバッグ' END || lpad(source.order_series::text, 4, '0'),
  (1000 + (source.order_series % 6) * 250)::bigint,
  1,
  CASE source.order_series % 3 WHEN 0 THEN jsonb_build_object('size', 'M') WHEN 1 THEN '{}'::jsonb ELSE jsonb_build_object('color', 'red') END,
  CASE WHEN source.order_series % 3 = 0 THEN lpad((source.series % 99 + 1)::text, 2, '0') ELSE NULL END,
  CASE WHEN source.order_series % 4 = 0 THEN '追加検証' || source.series ELSE NULL END,
  (1000 + (source.order_series % 6) * 250)::bigint
FROM source
JOIN inserted_entries inserted ON inserted.id = source.entry_id
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO order_idempotency_keys
  (id, tenant_id, actor_user_id, idempotency_key, request_hash, resource_type, resource_id)
SELECT
  ('00000000-0000-7000-8000-' || lpad((402000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + (((series - 1) % 334) * 3 + 2))::text, 12, '0'))::uuid,
  'club-' || CASE WHEN (((series - 1) % 334) * 3 + 2) >= 1000 THEN (((series - 1) % 334) * 3 + 2)::text ELSE lpad((((series - 1) % 334) * 3 + 2)::text, 3, '0') END || '-member-' || lpad(((series % 7) + 1)::text, 2, '0') || '-parent-2',
  'scale-additional-order-' || lpad(series::text, 4, '0'),
  lpad(to_hex(series + 1001), 64, '0'),
  'order-entry',
  ('00000000-0000-7000-8000-' || lpad((382000 + series)::text, 12, '0'))::uuid
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (tenant_id, actor_user_id, idempotency_key) DO NOTHING;
`,
    sql`
INSERT INTO announcement_attachments (tenant_id, announcement_id, attachment_id, position, media_type, byte_size)
SELECT
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((8000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((340000 + series)::text, 12, '0'))::uuid,
  1,
  CASE series % 3 WHEN 0 THEN 'application/pdf' WHEN 1 THEN 'image/png' ELSE 'image/jpeg' END,
  1024 + (series % 32) * 1024
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (tenant_id, announcement_id, attachment_id) DO NOTHING;
`,
    sql`
INSERT INTO line_notification_queue
  (id, tenant_id, group_id, created_by_user_id, source_type, source_id, title, body, deep_link, status, attempts)
SELECT
  ('00000000-0000-7000-8000-' || lpad((420000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  'Cscale-team-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END,
  'club-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END || '-owner',
  CASE series % 3 WHEN 0 THEN 'event'::line_notification_source WHEN 1 THEN 'bulletin'::line_notification_source ELSE 'deadline'::line_notification_source END,
  CASE series % 3 WHEN 0 THEN '00000000-0000-7000-8000-' || lpad((7000 + series)::text, 12, '0') WHEN 1 THEN '00000000-0000-7000-8000-' || lpad((8000 + series)::text, 12, '0') ELSE 'deadline-' || series END,
  CASE series % 3 WHEN 0 THEN '予定のお知らせ' WHEN 1 THEN '回覧のお知らせ' ELSE '締切のお知らせ' END,
  CASE series % 3 WHEN 0 THEN '予定の詳細を確認してください。' WHEN 1 THEN '回覧の詳細を確認してください。' ELSE '締切を確認してください。' END,
  'http://localhost:5173/fixture/' || series,
  'pending',
  0
FROM generate_series(1, 1000) AS generated(series)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
UPDATE line_notification_queue
SET status = 'sending', attempts = 1
WHERE id BETWEEN '00000000-0000-7000-8000-000000420001'::uuid AND '00000000-0000-7000-8000-000000421000'::uuid
  AND right(id::text, 12)::bigint % 5 IN (1, 2, 3, 4)
  AND status = 'pending';
`,
    sql`
UPDATE line_notification_queue
SET status = 'sent', provider_message_id = 'provider-scale-' || right(id::text, 4), sent_at = timestamp '2026-08-20T00:00:00Z'
WHERE id BETWEEN '00000000-0000-7000-8000-000000420001'::uuid AND '00000000-0000-7000-8000-000000421000'::uuid
  AND right(id::text, 12)::bigint % 5 = 1
  AND status = 'sending';
`,
    sql`
UPDATE line_notification_queue
SET status = 'failed', last_error = 'fixture provider failure', next_retry_at = timestamp '2099-01-01T00:00:00Z'
WHERE id BETWEEN '00000000-0000-7000-8000-000000420001'::uuid AND '00000000-0000-7000-8000-000000421000'::uuid
  AND right(id::text, 12)::bigint % 5 IN (2, 4)
  AND status = 'sending';
`,
    sql`
INSERT INTO line_webhook_receipts (tenant_id, group_id, webhook_event_id, received_at)
SELECT
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  'Cscale-team-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END,
  'scale-webhook-' || lpad(series::text, 4, '0'),
  timestamp '2026-08-20T00:00:00Z' + (series || ' minutes')::interval
FROM generate_series(1, 1000) AS generated(series)
ON CONFLICT (group_id, webhook_event_id) DO NOTHING;
`,
    sql`
INSERT INTO ride_plans
  (id, tenant_id, title, departure_at, pickup_maps_url, destination_maps_url, status)
SELECT
  ('00000000-0000-7000-8000-' || lpad((430000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  CASE series % 3 WHEN 0 THEN '試合送迎' WHEN 1 THEN '練習送迎' ELSE '大会送迎' END || lpad(series::text, 4, '0'),
  timestamp '2099-07-01T07:00:00Z' + (series || ' days')::interval,
  NULL,
  NULL,
  'draft'::ride_plan_status
FROM generate_series(1, 1001) AS generated(series)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
UPDATE ride_plans
SET status = 'open'
WHERE id BETWEEN '00000000-0000-7000-8000-000000430001'::uuid AND '00000000-0000-7000-8000-000000431000'::uuid
  AND status = 'draft';
`,
    sql`
INSERT INTO ride_offers (id, tenant_id, plan_id, driver_user_id, capacity, status)
SELECT
  ('00000000-0000-7000-8000-' || lpad((440000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((430000 + series)::text, 12, '0'))::uuid,
  'club-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END || '-member-10-parent-1',
  4 + (series % 5),
  'open'::ride_offer_status
FROM generate_series(1, 1000) AS generated(series)
WHERE NOT EXISTS (
  SELECT 1 FROM ride_offers existing
  WHERE existing.id = ('00000000-0000-7000-8000-' || lpad((440000 + series)::text, 12, '0'))::uuid
)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO ride_offers (id, tenant_id, plan_id, driver_user_id, capacity, status)
SELECT
  ('00000000-0000-7000-8000-' || lpad((441000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((430000 + series)::text, 12, '0'))::uuid,
  'club-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END || '-member-10-parent-2',
  1 + (series % 3),
  'open'::ride_offer_status
FROM generate_series(1, 1000) AS generated(series)
WHERE NOT EXISTS (
  SELECT 1 FROM ride_offers existing
  WHERE existing.id = ('00000000-0000-7000-8000-' || lpad((441000 + series)::text, 12, '0'))::uuid
)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO ride_requests (id, tenant_id, plan_id, member_id, requester_user_id, passenger_count, status)
SELECT
  ('00000000-0000-7000-8000-' || lpad((450000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((430000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((20000 + ((series - 1) * 10) + 1)::text, 12, '0'))::uuid,
  'club-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END || '-member-01-parent-1',
  1 + (series % 3),
  'pending'::ride_request_status
FROM generate_series(1, 1000) AS generated(series)
WHERE NOT EXISTS (
  SELECT 1 FROM ride_requests existing
  WHERE existing.id = ('00000000-0000-7000-8000-' || lpad((450000 + series)::text, 12, '0'))::uuid
)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO ride_requests (id, tenant_id, plan_id, member_id, requester_user_id, passenger_count, status)
SELECT
  ('00000000-0000-7000-8000-' || lpad((451000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((430000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((20000 + ((series - 1) * 10) + 2)::text, 12, '0'))::uuid,
  'club-' || CASE WHEN series >= 1000 THEN series::text ELSE lpad(series::text, 3, '0') END || '-member-02-parent-2',
  1 + (series % 2),
  'pending'::ride_request_status
FROM generate_series(1, 1000) AS generated(series)
WHERE NOT EXISTS (
  SELECT 1 FROM ride_requests existing
  WHERE existing.id = ('00000000-0000-7000-8000-' || lpad((451000 + series)::text, 12, '0'))::uuid
)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
INSERT INTO ride_assignments (id, tenant_id, plan_id, request_id, offer_id, passenger_count)
SELECT
  ('00000000-0000-7000-8000-' || lpad((460000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((10000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((430000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((450000 + series)::text, 12, '0'))::uuid,
  ('00000000-0000-7000-8000-' || lpad((440000 + series)::text, 12, '0'))::uuid,
  1 + (series % 3)
FROM generate_series(1, 1000) AS generated(series)
WHERE NOT EXISTS (
  SELECT 1 FROM ride_assignments existing
  WHERE existing.id = ('00000000-0000-7000-8000-' || lpad((460000 + series)::text, 12, '0'))::uuid
)
ON CONFLICT (id) DO NOTHING;
`,
    sql`
UPDATE ride_offers ro
SET driver_user_id = 'club-' || CASE
  WHEN right(ro.id::text, 12)::bigint - 440000 >= 1000
    THEN (right(ro.id::text, 12)::bigint - 440000)::text
  ELSE lpad((right(ro.id::text, 12)::bigint - 440000)::text, 3, '0')
END || '-member-10-parent-1'
WHERE ro.id BETWEEN '00000000-0000-7000-8000-000000440001'::uuid
                 AND '00000000-0000-7000-8000-000000441000'::uuid
  AND ro.tenant_id BETWEEN '00000000-0000-7000-8000-000000010001'::uuid
                       AND '00000000-0000-7000-8000-000000011001'::uuid
  AND ro.driver_user_id = 'club-' || lpad((right(ro.id::text, 12)::bigint - 440000)::text, 4, '0') || '-member-10-parent-1'
  AND EXISTS (
    SELECT 1 FROM ride_plans rp
    WHERE rp.tenant_id = ro.tenant_id
      AND rp.id = ro.plan_id
      AND rp.status <> 'finalized'::ride_plan_status
  );
`,
    sql`
UPDATE ride_offers ro
SET driver_user_id = 'club-' || CASE
  WHEN right(ro.id::text, 12)::bigint - 441000 >= 1000
    THEN (right(ro.id::text, 12)::bigint - 441000)::text
  ELSE lpad((right(ro.id::text, 12)::bigint - 441000)::text, 3, '0')
END || '-member-10-parent-2'
WHERE ro.id BETWEEN '00000000-0000-7000-8000-000000441001'::uuid
                 AND '00000000-0000-7000-8000-000000442000'::uuid
  AND ro.tenant_id BETWEEN '00000000-0000-7000-8000-000000010001'::uuid
                       AND '00000000-0000-7000-8000-000000011001'::uuid
  AND ro.driver_user_id = 'club-' || lpad((right(ro.id::text, 12)::bigint - 441000)::text, 4, '0') || '-member-10-parent-2'
  AND EXISTS (
    SELECT 1 FROM ride_plans rp
    WHERE rp.tenant_id = ro.tenant_id
      AND rp.id = ro.plan_id
      AND rp.status <> 'finalized'::ride_plan_status
  );
`,
    sql`
UPDATE ride_requests rr
SET requester_user_id = 'club-' || CASE
  WHEN right(rr.id::text, 12)::bigint - 450000 >= 1000
    THEN (right(rr.id::text, 12)::bigint - 450000)::text
  ELSE lpad((right(rr.id::text, 12)::bigint - 450000)::text, 3, '0')
END || '-member-01-parent-1'
WHERE rr.id BETWEEN '00000000-0000-7000-8000-000000450001'::uuid
                 AND '00000000-0000-7000-8000-000000451000'::uuid
  AND rr.tenant_id BETWEEN '00000000-0000-7000-8000-000000010001'::uuid
                       AND '00000000-0000-7000-8000-000000011001'::uuid
  AND rr.requester_user_id = 'club-' || lpad((right(rr.id::text, 12)::bigint - 450000)::text, 4, '0') || '-member-01-parent-1'
  AND EXISTS (
    SELECT 1 FROM ride_plans rp
    WHERE rp.tenant_id = rr.tenant_id
      AND rp.id = rr.plan_id
      AND rp.status <> 'finalized'::ride_plan_status
  );
`,
    sql`
UPDATE ride_requests rr
SET requester_user_id = 'club-' || CASE
  WHEN right(rr.id::text, 12)::bigint - 451000 >= 1000
    THEN (right(rr.id::text, 12)::bigint - 451000)::text
  ELSE lpad((right(rr.id::text, 12)::bigint - 451000)::text, 3, '0')
END || '-member-02-parent-2'
WHERE rr.id BETWEEN '00000000-0000-7000-8000-000000451001'::uuid
                 AND '00000000-0000-7000-8000-000000452000'::uuid
  AND rr.tenant_id BETWEEN '00000000-0000-7000-8000-000000010001'::uuid
                       AND '00000000-0000-7000-8000-000000011001'::uuid
  AND rr.requester_user_id = 'club-' || lpad((right(rr.id::text, 12)::bigint - 451000)::text, 4, '0') || '-member-02-parent-2'
  AND EXISTS (
    SELECT 1 FROM ride_plans rp
    WHERE rp.tenant_id = rr.tenant_id
      AND rp.id = rr.plan_id
      AND rp.status <> 'finalized'::ride_plan_status
  );
`,
    sql`
UPDATE tenant_memberships tm
SET display_name = '送迎担当 ' || tm.user_id
FROM ride_offers ro
WHERE ro.tenant_id = tm.tenant_id
  AND ro.driver_user_id = tm.user_id
  AND ro.id BETWEEN '00000000-0000-7000-8000-000000440001'::uuid
                 AND '00000000-0000-7000-8000-000000442000'::uuid
  AND ro.tenant_id BETWEEN '00000000-0000-7000-8000-000000010001'::uuid
                       AND '00000000-0000-7000-8000-000000011001'::uuid
  AND tm.status = 'active'::membership_status
  AND NOT EXISTS (
    SELECT 1
      FROM ride_offers finalized_ro
      JOIN ride_assignments finalized_a
        ON finalized_a.tenant_id = finalized_ro.tenant_id
       AND finalized_a.plan_id = finalized_ro.plan_id
       AND finalized_a.offer_id = finalized_ro.id
      JOIN ride_plans finalized_rp
        ON finalized_rp.tenant_id = finalized_a.tenant_id
       AND finalized_rp.id = finalized_a.plan_id
     WHERE finalized_ro.tenant_id = tm.tenant_id
       AND finalized_ro.driver_user_id = tm.user_id
       AND finalized_rp.status = 'finalized'::ride_plan_status
  )
  AND NULLIF(BTRIM(tm.display_name), '') IS NULL;
`,
    sql`
UPDATE ride_requests
SET status = 'assigned'
WHERE id BETWEEN '00000000-0000-7000-8000-000000450001'::uuid AND '00000000-0000-7000-8000-000000451000'::uuid
  AND status = 'pending';
`,
    sql`
UPDATE ride_requests
SET status = CASE
  WHEN right(id::text, 12)::bigint % 3 = 0 OR right(id::text, 12)::bigint % 2 = 0 THEN 'cancelled'::ride_request_status
  ELSE 'unassigned'::ride_request_status
END
WHERE id BETWEEN '00000000-0000-7000-8000-000000451001'::uuid AND '00000000-0000-7000-8000-000000452000'::uuid
  AND status = 'pending';
`,
    sql`
UPDATE ride_offers
SET status = 'cancelled'
WHERE id BETWEEN '00000000-0000-7000-8000-000000441001'::uuid AND '00000000-0000-7000-8000-000000442000'::uuid
  AND status = 'open';
`,
    sql`
UPDATE ride_plans
SET status = 'closed'
WHERE id BETWEEN '00000000-0000-7000-8000-000000430001'::uuid AND '00000000-0000-7000-8000-000000431000'::uuid
  AND right(id::text, 12)::bigint % 3 IN (0, 2)
  AND status = 'open';
`,
    sql`
UPDATE ride_plans
SET status = 'finalized'
WHERE id BETWEEN '00000000-0000-7000-8000-000000430001'::uuid AND '00000000-0000-7000-8000-000000431000'::uuid
  AND right(id::text, 12)::bigint % 3 = 0
  AND status = 'closed';
`,
  );

  if (authUserId) {
    statements.push(sql`
INSERT INTO tenant_memberships (id, tenant_id, user_id, role, status)
VALUES ('${uuid(104)}', '${tenantA}', '${authUserId}', 'owner', 'active')
ON CONFLICT (tenant_id, user_id) DO UPDATE
SET role = 'owner', status = 'active';
`);
  }

  if (authTeamCUserId) {
    statements.push(sql`
INSERT INTO tenant_memberships (id, tenant_id, user_id, role, status)
VALUES ('${uuid(112)}', '${tenantC}', '${authTeamCUserId}', 'owner', 'active')
ON CONFLICT (tenant_id, user_id) DO UPDATE
SET role = 'owner', status = 'active';
`);
  }

  return statements;
}

export function buildFixtureCountQuery(): string {
  return fixtureTables
    .map(
      (table) =>
        `SELECT '${table}'::text AS table_name, count(*)::bigint AS row_count FROM ${table}`,
    )
    .join('\nUNION ALL\n');
}

export function assertFixtureCounts(
  rows: readonly FixtureCountRow[],
  minimum = scaleFixture.minimumRowsPerTable,
): void {
  const counts = new Map(
    rows.map((row) => [row.table_name, Number(row.row_count)]),
  );
  const insufficient = fixtureTables.filter(
    (table) =>
      (counts.get(table) ?? 0) < (fixtureMinimumRows[table] ?? minimum),
  );
  assert.deepEqual(
    insufficient,
    [],
    `fixtureの件数不足: ${insufficient.join(', ') || 'なし'}`,
  );
}

async function main(): Promise<void> {
  assertTestDatabaseTarget();
  assert.ok(process.env.DIRECT_URL, 'DIRECT_URLが必要です。');
  const authUserId = assertAuthUserId(process.env.TEST_AUTH_USER_ID);
  const authTeamCUserId = assertAuthUserId(
    process.env.TEST_AUTH_TEAM_C_USER_ID,
  );
  const statements = buildTestDataStatements(authUserId, authTeamCUserId);

  await withPostgresClient(process.env.DIRECT_URL, async (client) => {
    // FORCE RLSは本番の越境防止に必要なため、test専用fixture投入の間だけowner権限で停止する。
    try {
      for (const table of fixtureTables)
        await client.$executeRawUnsafe(
          `ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`,
        );
      for (const statement of statements)
        await client.$executeRawUnsafe(statement);
    } finally {
      for (const table of fixtureTables) {
        await client.$executeRawUnsafe(
          `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,
        );
        await client.$executeRawUnsafe(
          `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`,
        );
      }
    }
    const counts = await client.$queryRawUnsafe<FixtureCountRow[]>(
      buildFixtureCountQuery(),
    );
    assertFixtureCounts(counts);
  });
  console.log('ローカル用テストデータを投入しました。');
}

const invokedScript = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedScript) await main();

export { main };
