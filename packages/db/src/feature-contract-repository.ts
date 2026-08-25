import {
  evaluateEffectiveFeatures,
  type FeatureContractSnapshot,
  type FeatureFlagSource,
} from '@cocolo/domain/feature-contract';
import type { Prisma, PrismaClient } from '@prisma/client';

export type FeatureContractErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'PAID_FEATURE_REQUIRES_PLAN';

type FeatureContractMemberRole = 'owner' | 'admin' | 'staff' | 'guardian';
type FeatureContractRlsRole = FeatureContractMemberRole | 'operator';

export class FeatureContractError extends Error {
  readonly status: 403 | 404;
  readonly code: FeatureContractErrorCode;

  constructor(
    code: FeatureContractErrorCode,
    message: string,
    status: 403 | 404,
  ) {
    super(message);
    this.name = 'FeatureContractError';
    this.code = code;
    this.status = status;
  }
}

export type FeatureContractRepository = {
  get: (input: {
    tenantId: string;
    actorUserId: string;
    role: FeatureContractMemberRole;
  }) => Promise<FeatureContractSnapshot>;
  setFreeFlag: (input: {
    tenantId: string;
    actorUserId: string;
    role: 'owner' | 'admin';
    featureKey: string;
    enabled: boolean;
    reason: string;
  }) => Promise<FeatureContractSnapshot>;
  syncPlan: (input: {
    tenantId: string;
    actorUserId: string;
    planKey: string;
    status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'expired';
    featureKeys: string[];
    billingProviderSubscriptionId: string | null;
    startsAt: Date;
    endsAt: Date | null;
  }) => Promise<void>;
  grantPaidFeature: (input: {
    tenantId: string;
    actorUserId: string;
    featureKey: string;
    enabled: boolean;
    reason: string;
    startsAt: Date;
    endsAt: Date | null;
  }) => Promise<void>;
};

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

async function setRlsContext(
  client: DatabaseClient,
  input: {
    tenantId: string;
    userId: string;
    role: FeatureContractRlsRole;
  },
) {
  await client.$queryRaw`
    SELECT
      set_config('app.tenant_id', ${input.tenantId}, true),
      set_config('app.user_id', ${input.userId}, true),
      set_config('app.role', ${input.role}, true)
  `;
}

async function assertActiveMembership(
  client: DatabaseClient,
  input: {
    tenantId: string;
    userId: string;
    role: FeatureContractMemberRole;
  },
) {
  const membership = await client.tenantMembership.findUnique({
    where: {
      tenantId_userId: { tenantId: input.tenantId, userId: input.userId },
    },
    select: { role: true, status: true },
  });
  if (membership?.status !== 'active' || membership?.role !== input.role)
    throw new FeatureContractError(
      'FORBIDDEN',
      'チームの機能契約を確認できません。',
      403,
    );
}

function toSnapshot(
  definitions: Array<{
    key: string;
    billingType: 'free' | 'paid';
    displayName: string;
    defaultEnabled: boolean;
  }>,
  plan: {
    planKey: string;
    status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'expired';
    featureKeys: string[];
    startsAt: Date;
    endsAt: Date | null;
  } | null,
  flags: Array<{
    featureKey: string;
    enabled: boolean;
    source: FeatureFlagSource;
    startsAt: Date;
    endsAt: Date | null;
  }>,
): FeatureContractSnapshot {
  return {
    planKey: plan?.planKey ?? null,
    planStatus: plan?.status ?? null,
    features: evaluateEffectiveFeatures({ definitions, plan, flags }),
  };
}

export function createFeatureContractRepository(
  client: PrismaClient,
): FeatureContractRepository {
  async function read(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      actorUserId: string;
      role: 'owner' | 'admin' | 'staff' | 'guardian';
    },
  ) {
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
    const [definitions, plan, flags] = await Promise.all([
      tx.featureDefinition.findMany({ orderBy: { key: 'asc' } }),
      tx.tenantPlan.findUnique({ where: { tenantId: input.tenantId } }),
      tx.tenantFeatureFlag.findMany({
        where: { tenantId: input.tenantId },
        orderBy: { featureKey: 'asc' },
      }),
    ]);
    return toSnapshot(
      definitions.map((definition) => ({
        key: definition.key,
        billingType: definition.billingType,
        displayName: definition.displayName,
        defaultEnabled: definition.defaultEnabled,
      })),
      plan
        ? {
            planKey: plan.planKey,
            status: plan.status,
            featureKeys: plan.featureKeys,
            startsAt: plan.startsAt,
            endsAt: plan.endsAt,
          }
        : null,
      flags.map((flag) => ({
        featureKey: flag.featureKey,
        enabled: flag.enabled,
        source: flag.source,
        startsAt: flag.startsAt,
        endsAt: flag.endsAt,
      })),
    );
  }

  return {
    get: (input) => client.$transaction((tx) => read(tx, input)),
    setFreeFlag: (input) =>
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
        const definition = await tx.featureDefinition.findUnique({
          where: { key: input.featureKey },
          select: { billingType: true },
        });
        if (!definition)
          throw new FeatureContractError(
            'NOT_FOUND',
            '指定された機能が見つかりません。',
            404,
          );
        if (definition.billingType !== 'free')
          throw new FeatureContractError(
            'PAID_FEATURE_REQUIRES_PLAN',
            '有償機能は有効なプランから付与してください。',
            403,
          );

        const now = new Date();
        await tx.tenantFeatureFlag.upsert({
          where: {
            tenantId_featureKey: {
              tenantId: input.tenantId,
              featureKey: input.featureKey,
            },
          },
          create: {
            tenantId: input.tenantId,
            featureKey: input.featureKey,
            enabled: input.enabled,
            source: 'admin',
            changedByUserId: input.actorUserId,
            reason: input.reason,
            startsAt: now,
          },
          update: {
            enabled: input.enabled,
            source: 'admin',
            changedByUserId: input.actorUserId,
            reason: input.reason,
            startsAt: now,
            endsAt: null,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: input.tenantId,
            actorUserId: input.actorUserId,
            action: 'feature.flag.update',
            resourceType: 'feature_flag',
            metadata: {
              featureKey: input.featureKey,
              enabled: input.enabled,
              source: 'admin',
              reason: input.reason,
            },
          },
        });
        return read(tx, input);
      }),
    syncPlan: async (input) => {
      if (!input.planKey.trim() || input.planKey.length > 100)
        throw new FeatureContractError(
          'NOT_FOUND',
          'プランキーが不正です。',
          404,
        );
      if (input.endsAt !== null && input.startsAt >= input.endsAt)
        throw new FeatureContractError(
          'FORBIDDEN',
          'プランの適用期間が不正です。',
          403,
        );
      const featureKeys = [...new Set(input.featureKeys)];
      await client.$transaction(async (tx) => {
        await setRlsContext(tx, {
          tenantId: input.tenantId,
          userId: input.actorUserId,
          role: 'operator',
        });
        const plan = await tx.tenantPlan.upsert({
          where: { tenantId: input.tenantId },
          create: {
            tenantId: input.tenantId,
            planKey: input.planKey,
            status: input.status,
            featureKeys,
            billingProviderSubscriptionId: input.billingProviderSubscriptionId,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
          },
          update: {
            planKey: input.planKey,
            status: input.status,
            featureKeys,
            billingProviderSubscriptionId: input.billingProviderSubscriptionId,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: input.tenantId,
            actorUserId: input.actorUserId,
            action: 'feature.plan.sync',
            resourceType: 'tenant_plan',
            resourceId: plan.id,
            metadata: {
              planKey: input.planKey,
              status: input.status,
              featureKeys,
              billingProviderSubscriptionId:
                input.billingProviderSubscriptionId,
              startsAt: input.startsAt.toISOString(),
              endsAt: input.endsAt?.toISOString() ?? null,
            },
          },
        });
      });
    },
    grantPaidFeature: async (input) => {
      if (!input.reason.trim() || input.reason.length > 500)
        throw new FeatureContractError(
          'FORBIDDEN',
          '付与理由が不正です。',
          403,
        );
      if (input.endsAt !== null && input.startsAt >= input.endsAt)
        throw new FeatureContractError(
          'FORBIDDEN',
          'feature flagの適用期間が不正です。',
          403,
        );
      await client.$transaction(async (tx) => {
        await setRlsContext(tx, {
          tenantId: input.tenantId,
          userId: input.actorUserId,
          role: 'operator',
        });
        const definition = await tx.featureDefinition.findUnique({
          where: { key: input.featureKey },
          select: { billingType: true },
        });
        if (!definition)
          throw new FeatureContractError(
            'NOT_FOUND',
            '指定された機能が見つかりません。',
            404,
          );
        if (definition.billingType !== 'paid')
          throw new FeatureContractError(
            'FORBIDDEN',
            '無償機能はチーム管理者が変更してください。',
            403,
          );
        await tx.tenantFeatureFlag.upsert({
          where: {
            tenantId_featureKey: {
              tenantId: input.tenantId,
              featureKey: input.featureKey,
            },
          },
          create: {
            tenantId: input.tenantId,
            featureKey: input.featureKey,
            enabled: input.enabled,
            source: 'operator',
            changedByUserId: input.actorUserId,
            reason: input.reason,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
          },
          update: {
            enabled: input.enabled,
            source: 'operator',
            changedByUserId: input.actorUserId,
            reason: input.reason,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: input.tenantId,
            actorUserId: input.actorUserId,
            action: 'feature.flag.grant',
            resourceType: 'feature_flag',
            metadata: {
              featureKey: input.featureKey,
              enabled: input.enabled,
              source: 'operator',
              reason: input.reason,
              startsAt: input.startsAt.toISOString(),
              endsAt: input.endsAt?.toISOString() ?? null,
            },
          },
        });
      });
    },
  };
}
