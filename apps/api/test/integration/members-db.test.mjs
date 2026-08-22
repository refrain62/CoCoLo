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

test('実PostgreSQLのRLSがownerのtenant境界を強制する', async () => {
  const membership =
    await repositories.membershipRepository.findActiveByUserId('owner-a');
  assert.deepEqual(membership, { tenantId: TENANT_A, role: 'owner' });

  const members = await repositories.memberRepository.list({
    tenantId: TENANT_A,
    userId: 'owner-a',
    role: 'owner',
    query: { page: 1, pageSize: 50 },
  });

  assert.deepEqual(
    members.map((member) => member.id).sort(),
    [MEMBER_A, MEMBER_A2].sort(),
  );
  assert.equal(
    members.some((member) => member.tenantId === TENANT_B),
    false,
  );
});

test('実PostgreSQLのRLSがguardianを担当部員だけに限定する', async () => {
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

test.after(async () => {
  await prisma.$disconnect();
});
