import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemberRepositories, createPrismaClient } from '@cocolo/db';

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const TENANT_B = '00000000-0000-7000-8000-000000000002';
const MEMBER_A = '00000000-0000-7000-8000-000000000201';
const MEMBER_A2 = '00000000-0000-7000-8000-000000000202';
const MEMBER_B = '00000000-0000-7000-8000-000000000203';
const FISCAL_YEAR = 2000 + (Date.now() % 101);
const FAILED_FISCAL_YEAR = 2000 + ((Date.now() + 1) % 101);

assert.ok(process.env.DATABASE_URL, 'DATABASE_URLが必要です');

const prisma = createPrismaClient();
const repositories = createMemberRepositories(prisma);

async function setMemberGrade(
  tenantId: string,
  userId: string,
  memberId: string,
  gradeLevel: number,
) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT
        set_config('app.tenant_id', ${tenantId}, true),
        set_config('app.user_id', ${userId}, true),
        set_config('app.role', 'owner', true)
    `;
    await tx.member.update({
      where: { tenantId_id: { tenantId, id: memberId } },
      data: { gradeLevel },
    });
  });
}

test('年度繰り上げのプレビューは在籍中の学生だけを同じテナントで計画する', async () => {
  const result = await repositories.promotionRepository.run({
    tenantId: TENANT_A,
    actorUserId: 'owner-a',
    role: 'owner',
    mode: 'preview',
    fiscalYear: FISCAL_YEAR,
    idempotencyKey: null,
  });

  assert.equal(result.status, 'preview');
  assert.equal(result.previewCount, 2);
  assert.equal(result.promotedCount, 2);
  const previewResult = result.result as {
    changes: Array<{ id: string }>;
  };
  assert.deepEqual(
    previewResult.changes.map((change) => change.id),
    [MEMBER_A, MEMBER_A2],
  );
});

test('年度繰り上げの実行は一度だけ更新し、同じキーでは追加変更を行わない', async () => {
  const result = await repositories.promotionRepository.run({
    tenantId: TENANT_A,
    actorUserId: 'owner-a',
    role: 'owner',
    mode: 'execute',
    fiscalYear: FISCAL_YEAR,
    idempotencyKey: `promotion-${FISCAL_YEAR}-a`,
  });
  const retry = await repositories.promotionRepository.run({
    tenantId: TENANT_A,
    actorUserId: 'owner-a',
    role: 'owner',
    mode: 'execute',
    fiscalYear: FISCAL_YEAR,
    idempotencyKey: `promotion-${FISCAL_YEAR}-a`,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.promotedCount, 2);
  assert.deepEqual(retry, result);
  await assert.rejects(
    repositories.promotionRepository.run({
      tenantId: TENANT_A,
      actorUserId: 'owner-a',
      role: 'owner',
      mode: 'preview',
      fiscalYear: FISCAL_YEAR,
      idempotencyKey: `promotion-${FISCAL_YEAR}-a`,
    }),
    /同じ Idempotency-Key でリクエスト内容が変更されています。/,
  );

  const members = await repositories.memberRepository.list({
    tenantId: TENANT_A,
    userId: 'owner-a',
    role: 'owner',
    query: { page: 1, pageSize: 50 },
  });
  assert.equal(
    members.find((member) => member.id === MEMBER_A)?.gradeLevel,
    10,
  );
  assert.equal(
    members.find((member) => member.id === MEMBER_A2)?.gradeLevel,
    9,
  );

  const auditEntries = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT
        set_config('app.tenant_id', ${TENANT_A}, true),
        set_config('app.user_id', 'owner-a', true),
        set_config('app.role', 'owner', true)
    `;
    return tx.auditLog.findMany({
      where: {
        tenantId: TENANT_A,
        action: { in: ['member.promote.preview', 'member.promote.execute'] },
      },
      select: { metadata: true },
    });
  });
  assert.equal(
    auditEntries.some((entry) =>
      JSON.stringify(entry.metadata).includes('テスト部員'),
    ),
    false,
  );
});

test('年度繰り上げは別テナントの部員を更新せず、同じ年度を独立して実行できる', async () => {
  const result = await repositories.promotionRepository.run({
    tenantId: TENANT_B,
    actorUserId: 'owner-b',
    role: 'owner',
    mode: 'execute',
    fiscalYear: FISCAL_YEAR,
    idempotencyKey: `promotion-${FISCAL_YEAR}-b`,
  });

  assert.equal(result.promotedCount, 1);
  const tenantBMembers = await repositories.memberRepository.list({
    tenantId: TENANT_B,
    userId: 'owner-b',
    role: 'owner',
    query: { page: 1, pageSize: 50 },
  });
  assert.equal(
    tenantBMembers.find((member) => member.id === MEMBER_B)?.gradeLevel,
    10,
  );
});

test('completed 状態の年度繰り上げをプレビューへ戻す遷移は DB トリガーで拒否する', async () => {
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT
          set_config('app.tenant_id', ${TENANT_A}, true),
          set_config('app.user_id', 'owner-a', true),
          set_config('app.role', 'owner', true)
      `;
      await tx.promotionRun.update({
        where: {
          tenantId_fiscalYear: {
            tenantId: TENANT_A,
            fiscalYear: FISCAL_YEAR,
          },
        },
        data: { status: 'preview' },
      });
    }),
    /completedからの状態変更はできません/,
  );
});

test('学年上限超過はfailedに記録し、修正後の同一key再試行でcompletedにできる', async () => {
  await setMemberGrade(TENANT_A, 'owner-a', MEMBER_A2, 99);
  try {
    const failed = await repositories.promotionRepository.run({
      tenantId: TENANT_A,
      actorUserId: 'owner-a',
      role: 'owner',
      mode: 'execute',
      fiscalYear: FAILED_FISCAL_YEAR,
      idempotencyKey: `promotion-${FAILED_FISCAL_YEAR}-failed`,
    });

    assert.equal(failed.status, 'failed');
    assert.deepEqual(failed.result, { errorCode: 'PROMOTION_GRADE_LIMIT' });

    await setMemberGrade(TENANT_A, 'owner-a', MEMBER_A2, 9);
    const completed = await repositories.promotionRepository.run({
      tenantId: TENANT_A,
      actorUserId: 'owner-a',
      role: 'owner',
      mode: 'execute',
      fiscalYear: FAILED_FISCAL_YEAR,
      idempotencyKey: `promotion-${FAILED_FISCAL_YEAR}-failed`,
    });
    assert.equal(completed.status, 'completed');
  } finally {
    await setMemberGrade(TENANT_A, 'owner-a', MEMBER_A, 9);
    await setMemberGrade(TENANT_A, 'owner-a', MEMBER_A2, 8);
    await setMemberGrade(TENANT_B, 'owner-b', MEMBER_B, 9);
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
