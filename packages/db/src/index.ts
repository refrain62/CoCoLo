import { createHash } from 'node:crypto';
import { type PromotionMember, planPromotion } from '@cocolo/domain';
import {
  type MemberCategory,
  type MemberStatus,
  type Prisma,
  PrismaClient,
} from '@prisma/client';

export type MemberRole = 'owner' | 'admin' | 'staff' | 'guardian';
export type PromotionMode = 'preview' | 'execute';
export type PromotionRecord = {
  mode: PromotionMode;
  fiscalYear: number;
  status: 'preview' | 'completed' | 'failed';
  previewCount: number;
  promotedCount: number;
  result: unknown;
};

export class PromotionConflictError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'PromotionConflictError';
  }
}

export type MemberListQuery = {
  q?: string;
  status?: 'active' | 'suspended' | 'retired';
  category?: 'student' | 'adult';
  page: number;
  pageSize: number;
};
export type MemberCreateInput = {
  name: string;
  kana?: string | null;
  category: 'student' | 'adult';
  gradeLevel?: number | null;
  ageGroup?: string | null;
  status: 'active' | 'suspended';
};
export type MemberRecord = {
  id: string;
  tenantId: string;
  name: string;
  kana: string | null;
  category: 'student' | 'adult';
  gradeLevel: number | null;
  ageGroup: string | null;
  status: 'active' | 'suspended' | 'retired';
  createdAt: Date;
};

const memberSelect = {
  id: true,
  tenantId: true,
  name: true,
  kana: true,
  category: true,
  gradeLevel: true,
  ageGroup: true,
  status: true,
  createdAt: true,
} satisfies Prisma.MemberSelect;

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

async function setUserContext(client: DatabaseClient, userId: string) {
  await client.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
}

async function setRlsContext(
  client: DatabaseClient,
  input: { tenantId: string; userId: string; role: MemberRole },
) {
  await client.$queryRaw`
    SELECT
      set_config('app.tenant_id', ${input.tenantId}, true),
      set_config('app.user_id', ${input.userId}, true),
      set_config('app.role', ${input.role}, true)
  `;
}

function toRecord(member: {
  id: string;
  tenantId: string;
  name: string;
  kana: string | null;
  category: MemberCategory;
  gradeLevel: number | null;
  ageGroup: string | null;
  status: MemberStatus;
  createdAt: Date;
}): MemberRecord {
  return {
    ...member,
    category: member.category as MemberRecord['category'],
    status: member.status as MemberRecord['status'],
  };
}

async function assertActiveMembership(
  client: Prisma.TransactionClient,
  input: { tenantId: string; userId: string; role: MemberRole },
) {
  const memberships = await client.$queryRaw<
    Array<{ role: string; status: string }>
  >`
    SELECT role, status
    FROM tenant_memberships
    WHERE tenant_id = ${input.tenantId}::uuid
      AND user_id = ${input.userId}
    FOR UPDATE
  `;
  const membership = memberships[0];
  if (membership?.status !== 'active' || membership?.role !== input.role)
    throw new Error('active membership context changed');
}

function promotionRequestHash(input: {
  mode: PromotionMode;
  fiscalYear: number;
}) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function promotionResultPayload(
  plan: ReturnType<typeof planPromotion>,
): Prisma.InputJsonValue {
  return {
    promotedCount: plan.changes.length,
    changes: plan.changes.map((change) => ({ ...change })),
  };
}

function toPromotionRecord(
  run: {
    status: 'preview' | 'completed' | 'failed';
    fiscalYear: number;
    previewCount: number;
    result: Prisma.JsonValue | null;
  },
  mode: PromotionMode,
): PromotionRecord {
  const result = run.result as { promotedCount?: number } | null;
  return {
    mode,
    fiscalYear: run.fiscalYear,
    status: run.status,
    previewCount: run.previewCount,
    promotedCount: result?.promotedCount ?? 0,
    result,
  };
}

async function lockPromotionRun(
  client: Prisma.TransactionClient,
  input: { tenantId: string; fiscalYear: number },
) {
  await client.$queryRaw`
    SELECT id
    FROM promotion_runs
    WHERE tenant_id = ${input.tenantId}::uuid
      AND fiscal_year = ${input.fiscalYear}
    FOR UPDATE
  `;
  return client.promotionRun.findUnique({
    where: {
      tenantId_fiscalYear: {
        tenantId: input.tenantId,
        fiscalYear: input.fiscalYear,
      },
    },
  });
}

async function lockPromotionTenant(
  client: Prisma.TransactionClient,
  tenantId: string,
) {
  await client.$queryRaw`
    SELECT id
    FROM tenants
    WHERE id = ${tenantId}::uuid
    FOR UPDATE
  `;
}

async function createPromotionPlan(
  client: Prisma.TransactionClient,
  tenantId: string,
) {
  await client.$queryRaw`
    SELECT id
    FROM members
    WHERE tenant_id = ${tenantId}::uuid
      AND category = 'student'::member_category
      AND status = 'active'::member_status
    ORDER BY id
    FOR UPDATE
  `;
  const members = await client.member.findMany({
    where: { tenantId, category: 'student', status: 'active' },
    orderBy: { id: 'asc' },
    select: { id: true, category: true, gradeLevel: true, status: true },
  });
  return planPromotion(members as PromotionMember[]);
}

export function createPrismaClient() {
  return new PrismaClient();
}

export function createMemberRepositories(client: PrismaClient) {
  return {
    membershipRepository: {
      findActiveByUserId: async (userId: string) =>
        client.$transaction(async (tx) => {
          await setUserContext(tx, userId);
          const memberships = await tx.tenantMembership.findMany({
            where: { userId, status: 'active' },
            orderBy: { createdAt: 'asc' },
            select: { tenantId: true, role: true },
          });
          if (memberships.length !== 1) return null;
          const [membership] = memberships;
          if (!membership) return null;
          return {
            tenantId: membership.tenantId,
            role: membership.role as MemberRole,
          };
        }),
    },
    memberRepository: {
      list: async (input: {
        tenantId: string;
        userId: string;
        role: MemberRole;
        query: MemberListQuery;
      }) =>
        client.$transaction(async (tx) => {
          await setRlsContext(tx, input);
          await assertActiveMembership(tx, input);
          const where: Prisma.MemberWhereInput = {
            tenantId: input.tenantId,
          };
          if (input.query.q)
            where.OR = [
              { name: { contains: input.query.q, mode: 'insensitive' } },
              { kana: { contains: input.query.q, mode: 'insensitive' } },
            ];
          if (input.query.status) where.status = input.query.status;
          if (input.query.category) where.category = input.query.category;
          if (input.role === 'guardian')
            where.guardianLinks = {
              some: { tenantId: input.tenantId, userId: input.userId },
            };
          const members = await tx.member.findMany({
            where,
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            skip: (input.query.page - 1) * input.query.pageSize,
            take: input.query.pageSize,
            select: memberSelect,
          });
          await tx.auditLog.createMany({
            data: [
              {
                tenantId: input.tenantId,
                actorUserId: input.userId,
                action: 'member.list',
                resourceType: 'member',
                metadata: { query: input.query },
              },
            ],
          });
          return members.map(toRecord);
        }),
      create: async (
        input: { tenantId: string; actorUserId: string; role: MemberRole },
        member: MemberCreateInput,
      ) =>
        client.$transaction(async (tx) => {
          await setRlsContext(tx, {
            tenantId: input.tenantId,
            userId: input.actorUserId,
            role: input.role,
          });
          await assertActiveMembership(tx, {
            tenantId: input.tenantId,
            userId: input.actorUserId,
            role: input.role,
          });
          const created = await tx.member.create({
            data: {
              tenantId: input.tenantId,
              name: member.name,
              kana: member.kana ?? null,
              category: member.category,
              gradeLevel: member.gradeLevel ?? null,
              ageGroup: member.ageGroup ?? null,
              status: member.status,
            },
            select: memberSelect,
          });
          await tx.auditLog.createMany({
            data: [
              {
                tenantId: input.tenantId,
                actorUserId: input.actorUserId,
                action: 'member.create',
                resourceType: 'member',
                resourceId: created.id,
                metadata: { category: member.category },
              },
            ],
          });
          return toRecord(created);
        }),
    },
    promotionRepository: {
      run: async (input: {
        tenantId: string;
        actorUserId: string;
        role: MemberRole;
        mode: PromotionMode;
        fiscalYear: number;
        idempotencyKey: string | null;
      }) => {
        const requestHash = promotionRequestHash({
          mode: input.mode,
          fiscalYear: input.fiscalYear,
        });
        return client.$transaction(async (tx) => {
          await setRlsContext(tx, {
            tenantId: input.tenantId,
            userId: input.actorUserId,
            role: input.role,
          });
          await assertActiveMembership(tx, {
            tenantId: input.tenantId,
            userId: input.actorUserId,
            role: input.role,
          });
          await lockPromotionTenant(tx, input.tenantId);
          const sameKey = input.idempotencyKey
            ? await tx.promotionRun.findFirst({
                where: {
                  tenantId: input.tenantId,
                  idempotencyKey: input.idempotencyKey,
                },
              })
            : null;
          if (sameKey && sameKey.fiscalYear !== input.fiscalYear)
            throw new PromotionConflictError(
              'Idempotency-Keyが別年度で使用されています',
            );
          if (sameKey && sameKey.requestHash !== requestHash)
            throw new PromotionConflictError(
              '同じIdempotency-Keyでrequest内容が変更されています',
            );
          if (sameKey && input.mode === 'preview')
            return toPromotionRecord(sameKey, input.mode);

          let run = await lockPromotionRun(tx, {
            tenantId: input.tenantId,
            fiscalYear: input.fiscalYear,
          });
          if (run && run.actorUserId !== input.actorUserId)
            throw new PromotionConflictError(
              '同じ年度の年度繰り上げを別の実行者へ変更できません',
            );
          if (input.mode === 'preview') {
            if (run?.status === 'failed')
              throw new PromotionConflictError(
                'failedの年度繰り上げはexecuteで再試行してください',
              );
            if (run?.status === 'completed')
              return toPromotionRecord(run, input.mode);
            const plan = await createPromotionPlan(tx, input.tenantId);
            const result = promotionResultPayload(plan);
            run = run
              ? await tx.promotionRun.update({
                  where: { id: run.id },
                  data: {
                    status: 'preview',
                    previewCount: plan.previewCount,
                    actorUserId: input.actorUserId,
                    idempotencyKey: input.idempotencyKey,
                    requestHash: input.idempotencyKey ? requestHash : null,
                    result,
                  },
                })
              : await tx.promotionRun.create({
                  data: {
                    tenantId: input.tenantId,
                    fiscalYear: input.fiscalYear,
                    status: 'preview',
                    previewCount: plan.previewCount,
                    actorUserId: input.actorUserId,
                    idempotencyKey: input.idempotencyKey,
                    requestHash: input.idempotencyKey ? requestHash : null,
                    result,
                  },
                });
            await tx.auditLog.create({
              data: {
                tenantId: input.tenantId,
                actorUserId: input.actorUserId,
                action: 'member.promote.preview',
                resourceType: 'promotion_run',
                resourceId: run.id,
                metadata: {
                  fiscalYear: input.fiscalYear,
                  previewCount: plan.previewCount,
                },
              },
            });
            return toPromotionRecord(run, input.mode);
          }

          if (run?.status === 'completed')
            return toPromotionRecord(run, input.mode);
          const plan = await createPromotionPlan(tx, input.tenantId);
          const result = promotionResultPayload(plan);
          run = run
            ? await tx.promotionRun.update({
                where: { id: run.id },
                data: {
                  previewCount: plan.previewCount,
                  actorUserId: input.actorUserId,
                  idempotencyKey: input.idempotencyKey,
                  requestHash,
                  result,
                },
              })
            : await tx.promotionRun.create({
                data: {
                  tenantId: input.tenantId,
                  fiscalYear: input.fiscalYear,
                  status: 'preview',
                  previewCount: plan.previewCount,
                  actorUserId: input.actorUserId,
                  idempotencyKey: input.idempotencyKey,
                  requestHash,
                  result,
                },
              });
          for (const change of plan.changes)
            await tx.member.update({
              where: {
                tenantId_id: {
                  tenantId: input.tenantId,
                  id: change.id,
                },
              },
              data: { gradeLevel: change.toGradeLevel },
            });
          await tx.auditLog.create({
            data: {
              tenantId: input.tenantId,
              actorUserId: input.actorUserId,
              action: 'member.promote.execute',
              resourceType: 'promotion_run',
              resourceId: run.id,
              metadata: {
                fiscalYear: input.fiscalYear,
                promotedCount: plan.changes.length,
                changes: plan.changes.map((change) => ({ ...change })),
              },
            },
          });
          run = await tx.promotionRun.update({
            where: { id: run.id },
            data: {
              status: 'completed',
              executedAt: new Date(),
              result,
            },
          });
          return toPromotionRecord(run, input.mode);
        });
      },
    },
  };
}
