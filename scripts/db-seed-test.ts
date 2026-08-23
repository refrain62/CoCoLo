import assert from 'node:assert/strict';
import { withPostgresClient } from './postgres-client.ts';

// テナントA/Bとrole別fixtureを冪等に投入し、RLS・認可・guardian境界の統合テストを再現可能にする。
assert.ok(process.env.DATABASE_URL, 'DATABASE_URL が必要です');
assert.ok(process.env.DIRECT_URL, 'DIRECT_URL が必要です');
const statements = [
  `
INSERT INTO tenants (id, name)
VALUES
  ('00000000-0000-7000-8000-000000000001', 'テストチームA'),
  ('00000000-0000-7000-8000-000000000002', 'テストチームB')
ON CONFLICT (id) DO NOTHING;
`,
  `
INSERT INTO tenant_memberships (id, tenant_id, user_id, role, status)
VALUES
  ('00000000-0000-7000-8000-000000000101', '00000000-0000-7000-8000-000000000001', 'owner-a', 'owner', 'active'),
  ('00000000-0000-7000-8000-000000000102', '00000000-0000-7000-8000-000000000001', 'guardian-a', 'guardian', 'active'),
  ('00000000-0000-7000-8000-000000000103', '00000000-0000-7000-8000-000000000002', 'owner-b', 'owner', 'active')
ON CONFLICT (tenant_id, user_id) DO NOTHING;
`,
  `
INSERT INTO members (id, tenant_id, name, kana, category, grade_level, status)
VALUES
  ('00000000-0000-7000-8000-000000000201', '00000000-0000-7000-8000-000000000001', 'テスト部員A', 'てすとぶいんえー', 'student', 9, 'active'),
  ('00000000-0000-7000-8000-000000000202', '00000000-0000-7000-8000-000000000001', 'テスト部員A2', 'てすとぶいんえーつー', 'student', 8, 'active'),
  ('00000000-0000-7000-8000-000000000203', '00000000-0000-7000-8000-000000000002', 'テスト部員B', 'てすとぶいんびー', 'student', 9, 'active')
ON CONFLICT (id) DO NOTHING;
`,
  `
INSERT INTO guardian_members (id, tenant_id, user_id, member_id, relationship)
VALUES
  ('00000000-0000-7000-8000-000000000301', '00000000-0000-7000-8000-000000000001', 'guardian-a', '00000000-0000-7000-8000-000000000201', '母')
ON CONFLICT (tenant_id, user_id, member_id) DO NOTHING;
`,
];
await withPostgresClient(process.env.DIRECT_URL, async (client) => {
  for (const statement of statements) await client.$executeRawUnsafe(statement);
});
console.log('テストデータを投入しました。');
