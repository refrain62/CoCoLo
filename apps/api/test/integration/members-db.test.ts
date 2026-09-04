import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemberRepositories, createPrismaClient } from '@cocolo/db';

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const TENANT_B = '00000000-0000-7000-8000-000000000002';
const MEMBER_A = '00000000-0000-7000-8000-000000000201';
const MEMBER_A2 = '00000000-0000-7000-8000-000000000202';

assert.ok(process.env.DATABASE_URL, 'DATABASE_URLが必要です');

const prisma = createPrismaClient();
const repositories = createMemberRepositories(prisma);

test('実 PostgreSQL の RLS が owner のテナント境界を強制する', async () => {
  const membership =
    await repositories.membershipRepository.findActiveByUserId('owner-a');
  assert.deepEqual(membership, { tenantId: TENANT_A, role: 'owner' });

  const members = await repositories.memberRepository.list({
    tenantId: TENANT_A,
    userId: 'owner-a',
    role: 'owner',
    query: { page: 1, pageSize: 50 },
  });

  const memberIds = new Set(members.map((member) => member.id));
  assert.equal(memberIds.has(MEMBER_A), true);
  assert.equal(memberIds.has(MEMBER_A2), true);
  assert.equal(
    members.some((member) => member.tenantId === TENANT_B),
    false,
  );
});

test('実 PostgreSQL の RLS が guardian を担当部員だけに限定する', async () => {
  const membership =
    await repositories.membershipRepository.findActiveByUserId('guardian-a');
  assert.deepEqual(membership, { tenantId: TENANT_A, role: 'guardian' });

  const members = await repositories.memberRepository.list({
    tenantId: TENANT_A,
    userId: 'guardian-a',
    role: 'guardian',
    query: { page: 1, pageSize: 50 },
  });

  assert.deepEqual(
    members.map((member) => member.id),
    [MEMBER_A],
  );
});

test('実 PostgreSQL の owner 登録は同じトランザクションで監査される', async () => {
  const created = await repositories.memberRepository.create(
    {
      tenantId: TENANT_A,
      actorUserId: 'owner-a',
      role: 'owner',
    },
    {
      name: `統合テスト-${Date.now()}`,
      category: 'adult',
      ageGroup: '30代',
      status: 'active',
    },
  );

  assert.equal(created.tenantId, TENANT_A);
  assert.equal(created.category, 'adult');
  assert.equal(created.ageGroup, '30代');
});

test('部員編集と退部は状態遷移を監査し、退部を冪等に扱う', async () => {
  const created = await repositories.memberRepository.create(
    {
      tenantId: TENANT_A,
      actorUserId: 'owner-a',
      role: 'owner',
    },
    {
      name: `ライフサイクル-${Date.now()}`,
      category: 'adult',
      ageGroup: '40代',
      status: 'active',
    },
  );

  const updated = await repositories.memberRepository.update({
    tenantId: TENANT_A,
    actorUserId: 'owner-a',
    role: 'owner',
    memberId: created.id,
    member: {
      name: created.name,
      kana: null,
      category: 'adult',
      ageGroup: '40代',
      status: 'suspended',
    },
  });
  assert.equal(updated?.status, 'suspended');

  const retired = await repositories.memberRepository.retire({
    tenantId: TENANT_A,
    actorUserId: 'owner-a',
    role: 'owner',
    memberId: created.id,
  });
  const retried = await repositories.memberRepository.retire({
    tenantId: TENANT_A,
    actorUserId: 'owner-a',
    role: 'owner',
    memberId: created.id,
  });

  assert.equal(retired?.status, 'retired');
  assert.deepEqual(retried, retired);

  const auditLogs = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT
        set_config('app.tenant_id', ${TENANT_A}, true),
        set_config('app.user_id', 'owner-a', true),
        set_config('app.role', 'owner', true)
    `;
    return tx.auditLog.findMany({
      where: { tenantId: TENANT_A, resourceId: created.id },
      select: { action: true, metadata: true },
      orderBy: { createdAt: 'asc' },
    });
  });
  assert.equal(
    auditLogs.some(
      (log) =>
        log.action === 'member.update' &&
        JSON.stringify(log.metadata).includes('suspended'),
    ),
    true,
  );
  assert.equal(
    auditLogs.filter((log) => log.action === 'member.retire').length,
    2,
  );
});

test('別テナントの部員は編集・退部できず、退部済みは通常編集できない', async () => {
  const crossTenantUpdate = await repositories.memberRepository.update({
    tenantId: TENANT_A,
    actorUserId: 'owner-a',
    role: 'owner',
    memberId: '00000000-0000-7000-8000-000000000203',
    member: {
      name: '越境更新',
      category: 'student',
      gradeLevel: 10,
      status: 'active',
    },
  });
  const crossTenantRetire = await repositories.memberRepository.retire({
    tenantId: TENANT_A,
    actorUserId: 'owner-a',
    role: 'owner',
    memberId: '00000000-0000-7000-8000-000000000203',
  });
  assert.equal(crossTenantUpdate, null);
  assert.equal(crossTenantRetire, null);

  const created = await repositories.memberRepository.create(
    {
      tenantId: TENANT_A,
      actorUserId: 'owner-a',
      role: 'owner',
    },
    {
      name: `退部済み編集拒否-${Date.now()}`,
      category: 'adult',
      ageGroup: '50代',
      status: 'active',
    },
  );
  await repositories.memberRepository.retire({
    tenantId: TENANT_A,
    actorUserId: 'owner-a',
    role: 'owner',
    memberId: created.id,
  });
  await assert.rejects(
    repositories.memberRepository.update({
      tenantId: TENANT_A,
      actorUserId: 'owner-a',
      role: 'owner',
      memberId: created.id,
      member: {
        name: '退部済み編集',
        category: 'adult',
        ageGroup: '50代',
        status: 'active',
      },
    }),
    (error: unknown) =>
      error instanceof Error && 'status' in error && error.status === 409,
  );
});

test('部員一覧の監査ログへ検索語を保存しない', async () => {
  const searchTerm = `監査対象の個人名-${Date.now()}`;
  await repositories.memberRepository.list({
    tenantId: TENANT_A,
    userId: 'owner-a',
    role: 'owner',
    query: { q: searchTerm, page: 1, pageSize: 50 },
  });

  const auditLogs = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT
        set_config('app.tenant_id', ${TENANT_A}, true),
        set_config('app.user_id', 'owner-a', true),
        set_config('app.role', 'owner', true)
    `;
    return tx.auditLog.findMany({
      where: { tenantId: TENANT_A, action: 'member.list' },
      select: { metadata: true },
    });
  });

  assert.equal(
    auditLogs.some((log) => JSON.stringify(log.metadata).includes(searchTerm)),
    false,
  );
});

test.after(async () => {
  await prisma.$disconnect();
});
