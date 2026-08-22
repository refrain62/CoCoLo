import { createHash } from 'node:crypto';
import {
  type PromotionMember,
  PromotionPlanningError,
  planPromotion,
} from '@cocolo/domain';
import {
  type MemberCategory,
  type MemberStatus,
  type Prisma,
  PrismaClient,
  type Role,
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

export class MemberConflictError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'MemberConflictError';
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
export type MemberUpdateInput = {
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

// membership検索用のuser contextだけをtransaction内へ設定し、後続のRLS判定に利用する。
async function setUserContext(client: DatabaseClient, userId: string) {
  await client.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
}

// tenant・user・roleをtransaction-local設定へまとめて入れ、同じtransaction内の全クエリへRLS境界を適用する。
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

// Prismaのenum型と日時をAPI/DB repositoryの共通recordへ変換する。
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

// 認証時に解決した所属を同じtransactionで再確認し、呼び出し側が任意tenant/roleを注入できないようにする。
async function assertActiveMembership(
  client: Prisma.TransactionClient,
  input: { tenantId: string; userId: string; role: MemberRole },
) {
  // 所属変更と同一ユーザーの処理を直列化し、RLSのSELECT policyに従って確認する。
  const membershipLockKey = `${input.tenantId}:${input.userId}`;
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${membershipLockKey}, 0))
  `;
  const membership = await client.tenantMembership.findUnique({
    where: {
      tenantId_userId: {
        tenantId: input.tenantId,
        userId: input.userId,
      },
    },
    select: { role: true, status: true },
  });
  if (
    membership?.status !== 'active' ||
    membership?.role !== (input.role as Role)
  )
    throw new Error('有効な所属情報が処理中に変更されました。');
}

// 更新前の行をロックし、同じ部員への退部と編集の競合を直列化する。
async function lockMember(
  client: Prisma.TransactionClient,
  input: { tenantId: string; memberId: string },
) {
  await client.$queryRaw`
    SELECT id
    FROM members
    WHERE tenant_id = ${input.tenantId}::uuid
      AND id = ${input.memberId}::uuid
    FOR UPDATE
  `;
  return client.member.findUnique({
    where: {
      tenantId_id: {
        tenantId: input.tenantId,
        id: input.memberId,
      },
    },
    select: memberSelect,
  });
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

function promotionFailurePayload(): Prisma.InputJsonValue {
  return { errorCode: 'PROMOTION_GRADE_LIMIT' };
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
  // tenants テーブルにはアプリケーションロール向けの更新ポリシーを与えないため、tenant 単位の直列化はトランザクションロックで行う。
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))
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

async function markPromotionFailed(
  client: Prisma.TransactionClient,
  input: { tenantId: string; actorUserId: string; fiscalYear: number },
  runId: string,
) {
  const run = await client.promotionRun.update({
    where: { id: runId },
    data: { status: 'failed', result: promotionFailurePayload() },
  });
  await client.auditLog.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: 'member.promote.failed',
      resourceType: 'promotion_run',
      resourceId: run.id,
      metadata: {
        fiscalYear: input.fiscalYear,
        errorCode: 'PROMOTION_GRADE_LIMIT',
      },
    },
  });
  return run;
}

// API serverが利用するPrisma clientを生成する。transaction境界は各repository操作で管理する。
export function createPrismaClient() {
  return new PrismaClient();
}

// RLS context、入力条件、監査ログをrepositoryに閉じ込め、API handlerからDB境界を迂回させない。
export function createMemberRepositories(client: PrismaClient) {
  return {
    membershipRepository: {
      // active所属が複数ある場合はtenantを暗黙選択せず、API側で利用可能な所属なしとして扱う。
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
      // guardianは担当関係でさらに絞り、検索と監査を同じtransactionで完了させる。
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
            // membershipだけではなくguardian_membersの担当関係も境界条件にする。
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
          // 検索語は個人情報になり得るため保存せず、再現に必要な絞り込み条件だけを監査する。
          await tx.auditLog.createMany({
            data: [
              {
                tenantId: input.tenantId,
                actorUserId: input.userId,
                action: 'member.list',
                resourceType: 'member',
                metadata: {
                  filters: {
                    category: input.query.category ?? null,
                    status: input.query.status ?? null,
                    page: input.query.page,
                    pageSize: input.query.pageSize,
                  },
                },
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
          // 所属再確認、部員作成、監査を一つのtransactionに束ね、片方だけ成功する状態を防ぐ。
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
      update: async (input: {
        tenantId: string;
        actorUserId: string;
        role: MemberRole;
        memberId: string;
        member: MemberUpdateInput;
      }) =>
        client.$transaction(async (tx) => {
          // 所属確認、対象行のロック、更新、監査を同じtransactionで実行する。
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
          const before = await lockMember(tx, {
            tenantId: input.tenantId,
            memberId: input.memberId,
          });
          if (!before) return null;
          if (before.status === 'retired')
            throw new MemberConflictError(
              '退部済みの部員は通常編集できません。',
            );
          const updated = await tx.member.update({
            where: {
              tenantId_id: {
                tenantId: input.tenantId,
                id: input.memberId,
              },
            },
            data: {
              name: input.member.name,
              kana: input.member.kana ?? null,
              category: input.member.category,
              gradeLevel: input.member.gradeLevel ?? null,
              ageGroup: input.member.ageGroup ?? null,
              status: input.member.status,
            },
            select: memberSelect,
          });
          await tx.auditLog.create({
            data: {
              tenantId: input.tenantId,
              actorUserId: input.actorUserId,
              action: 'member.update',
              resourceType: 'member',
              resourceId: updated.id,
              metadata: {
                before: {
                  category: before.category,
                  status: before.status,
                },
                after: {
                  category: updated.category,
                  status: updated.status,
                },
              },
            },
          });
          return toRecord(updated);
        }),
      retire: async (input: {
        tenantId: string;
        actorUserId: string;
        role: MemberRole;
        memberId: string;
      }) =>
        client.$transaction(async (tx) => {
          // 退部処理は行ロックで一度だけ状態を遷移させ、再送時は同じ結果を返す。
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
          const before = await lockMember(tx, {
            tenantId: input.tenantId,
            memberId: input.memberId,
          });
          if (!before) return null;
          const updated =
            before.status === 'retired'
              ? before
              : await tx.member.update({
                  where: {
                    tenantId_id: {
                      tenantId: input.tenantId,
                      id: input.memberId,
                    },
                  },
                  data: { status: 'retired' },
                  select: memberSelect,
                });
          await tx.auditLog.create({
            data: {
              tenantId: input.tenantId,
              actorUserId: input.actorUserId,
              action: 'member.retire',
              resourceType: 'member',
              resourceId: updated.id,
              metadata: {
                beforeStatus: before.status,
                afterStatus: updated.status,
              },
            },
          });
          return toRecord(updated);
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
              'Idempotency-Key が別の年度で使用されています。',
            );
          if (sameKey && sameKey.requestHash !== requestHash)
            throw new PromotionConflictError(
              '同じ Idempotency-Key でリクエスト内容が変更されています。',
            );
          if (sameKey && input.mode === 'preview')
            return toPromotionRecord(sameKey, input.mode);

          let run = await lockPromotionRun(tx, {
            tenantId: input.tenantId,
            fiscalYear: input.fiscalYear,
          });
          if (run && run.actorUserId !== input.actorUserId)
            throw new PromotionConflictError(
              '同じ年度の年度繰り上げを別の実行者へ変更できません。',
            );
          if (run?.status !== 'completed') {
            if (
              run?.idempotencyKey &&
              run.idempotencyKey !== input.idempotencyKey
            )
              throw new PromotionConflictError(
                '同じ年度の Idempotency-Key は変更できません。',
              );
            if (run?.requestHash && run.requestHash !== requestHash)
              throw new PromotionConflictError(
                '同じ年度のリクエストハッシュは変更できません。',
              );
          }
          if (input.mode === 'preview') {
            if (run?.status === 'failed')
              throw new PromotionConflictError(
                'failed 状態の年度繰り上げは実行モードで再試行してください。',
              );
            if (run?.status === 'completed')
              return toPromotionRecord(run, input.mode);
            run = run
              ? await tx.promotionRun.update({
                  where: { id: run.id },
                  data: {
                    status: 'preview',
                    idempotencyKey: input.idempotencyKey,
                    requestHash: input.idempotencyKey ? requestHash : null,
                  },
                })
              : await tx.promotionRun.create({
                  data: {
                    tenantId: input.tenantId,
                    fiscalYear: input.fiscalYear,
                    status: 'preview',
                    previewCount: 0,
                    actorUserId: input.actorUserId,
                    idempotencyKey: input.idempotencyKey,
                    requestHash: input.idempotencyKey ? requestHash : null,
                  },
                });
            let plan: ReturnType<typeof planPromotion>;
            try {
              plan = await createPromotionPlan(tx, input.tenantId);
            } catch (error) {
              if (!(error instanceof PromotionPlanningError)) throw error;
              run = await markPromotionFailed(
                tx,
                {
                  tenantId: input.tenantId,
                  actorUserId: input.actorUserId,
                  fiscalYear: input.fiscalYear,
                },
                run.id,
              );
              return toPromotionRecord(run, input.mode);
            }
            const result = promotionResultPayload(plan);
            run = await tx.promotionRun.update({
              where: { id: run.id },
              data: {
                status: 'preview',
                previewCount: plan.previewCount,
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
          run = run
            ? await tx.promotionRun.update({
                where: { id: run.id },
                data: {
                  idempotencyKey: input.idempotencyKey,
                  requestHash,
                },
              })
            : await tx.promotionRun.create({
                data: {
                  tenantId: input.tenantId,
                  fiscalYear: input.fiscalYear,
                  status: 'preview',
                  previewCount: 0,
                  actorUserId: input.actorUserId,
                  idempotencyKey: input.idempotencyKey,
                  requestHash,
                },
              });
          let plan: ReturnType<typeof planPromotion>;
          try {
            plan = await createPromotionPlan(tx, input.tenantId);
          } catch (error) {
            if (!(error instanceof PromotionPlanningError)) throw error;
            run = await markPromotionFailed(
              tx,
              {
                tenantId: input.tenantId,
                actorUserId: input.actorUserId,
                fiscalYear: input.fiscalYear,
              },
              run.id,
            );
            return toPromotionRecord(run, input.mode);
          }
          const result = promotionResultPayload(plan);
          run = await tx.promotionRun.update({
            where: { id: run.id },
            data: {
              previewCount: plan.previewCount,
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
