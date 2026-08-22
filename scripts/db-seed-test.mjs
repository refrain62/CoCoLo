import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// テナントA/Bとrole別fixtureを冪等に投入し、RLS・認可・guardian境界の統合テストを再現可能にする。
assert.ok(process.env.DATABASE_URL, 'DATABASE_URL が必要です');
assert.ok(process.env.DIRECT_URL, 'DIRECT_URL が必要です');
const sql = `
INSERT INTO tenants (id, name)
VALUES
  ('00000000-0000-7000-8000-000000000001', 'テストチームA'),
  ('00000000-0000-7000-8000-000000000002', 'テストチームB')
ON CONFLICT (id) DO NOTHING;
INSERT INTO tenant_memberships (id, tenant_id, user_id, role, status)
VALUES
  ('00000000-0000-7000-8000-000000000101', '00000000-0000-7000-8000-000000000001', 'owner-a', 'owner', 'active'),
  ('00000000-0000-7000-8000-000000000102', '00000000-0000-7000-8000-000000000001', 'guardian-a', 'guardian', 'active'),
  ('00000000-0000-7000-8000-000000000103', '00000000-0000-7000-8000-000000000002', 'owner-b', 'owner', 'active')
ON CONFLICT (tenant_id, user_id) DO NOTHING;
INSERT INTO members (id, tenant_id, name, kana, category, grade_level, status)
VALUES
  ('00000000-0000-7000-8000-000000000201', '00000000-0000-7000-8000-000000000001', 'テスト部員A', 'てすとぶいんえー', 'student', 9, 'active'),
  ('00000000-0000-7000-8000-000000000202', '00000000-0000-7000-8000-000000000001', 'テスト部員A2', 'てすとぶいんえーつー', 'student', 8, 'active'),
  ('00000000-0000-7000-8000-000000000203', '00000000-0000-7000-8000-000000000002', 'テスト部員B', 'てすとぶいんびー', 'student', 9, 'active')
ON CONFLICT (id) DO NOTHING;
INSERT INTO guardian_members (id, tenant_id, user_id, member_id, relationship)
VALUES
  ('00000000-0000-7000-8000-000000000301', '00000000-0000-7000-8000-000000000001', 'guardian-a', '00000000-0000-7000-8000-000000000201', '母')
ON CONFLICT (tenant_id, user_id, member_id) DO NOTHING;
`;
const dockerContainer = process.env.PSQL_DOCKER_CONTAINER;
const dockerDatabase = process.env.PSQL_DOCKER_DATABASE ?? 'postgres';
const command = dockerContainer
  ? process.platform === 'win32'
    ? 'docker.exe'
    : 'docker'
  : process.platform === 'win32'
    ? 'psql.exe'
    : 'psql';
const args = dockerContainer
  ? [
      'exec',
      dockerContainer,
      'psql',
      '--no-psqlrc',
      '--username',
      'postgres',
      '--dbname',
      dockerDatabase,
      '--command',
      sql,
    ]
  : ['--no-psqlrc', '--dbname', process.env.DIRECT_URL, '--command', sql];
const result = spawnSync(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32' && !dockerContainer,
});
if (result.error) throw result.error;
assert.equal(result.status, 0, 'テストデータの投入に失敗しました。');
console.log('テストデータを投入しました。');
