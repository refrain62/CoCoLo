import { createHash } from 'node:crypto';
import {
  evaluateEffectiveFeatures,
  type FeatureContractSnapshot,
  type FeatureFlagSource,
} from '@cocolo/domain/feature-contract';
import type { Prisma, PrismaClient } from '@prisma/client';

export type FeatureContractErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAID_FEATURE_REQUIRES_PLAN';

type FeatureContractMemberRole = 'owner' | 'admin' | 'staff' | 'guardian';
type FeatureContractRlsRole = FeatureContractMemberRole | 'operator';

export class FeatureContractError extends Error {
  readonly status: 403 | 404 | 409;
  readonly code: FeatureContractErrorCode;

  constructor(
    code: FeatureContractErrorCode,
    message: string,
    status: 403 | 404 | 409,
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
    providerAccountId: string;
    eventId: string;
    version: number;
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
    providerAccountId: string;
    approvalId: string;
    billingStatus: 'active' | 'trialing' | 'past_due' | 'canceled' | 'expired';
    billingProviderSubscriptionId: string;
    approvalToken: string;
    eventId: string;
    version: number;
    featureKey: string;
    enabled: boolean;
    reason: string;
    startsAt: Date;
    endsAt: Date | null;
  }) => Promise<void>;
};

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

function payloadHash(input: object) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function secretHash(input: string) {
  return createHash('sha256').update(input).digest('hex');
}

async function lockTenant(client: Prisma.TransactionClient, tenantId: string) {
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${`feature-contract:${tenantId}`}, 0))
  `;
}

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
      const hash = payloadHash({
        tenantId: input.tenantId,
        providerAccountId: input.providerAccountId,
        eventId: input.eventId,
        version: input.version,
        planKey: input.planKey,
        status: input.status,
        featureKeys: [...featureKeys].sort(),
        billingProviderSubscriptionId: input.billingProviderSubscriptionId,
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt?.toISOString() ?? null,
      });
      await client.$transaction(async (tx) => {
        await setRlsContext(tx, {
          tenantId: input.tenantId,
          userId: input.actorUserId,
          role: 'operator',
        });
        await lockTenant(tx, input.tenantId);
        const billingAccount = await tx.tenantBillingAccount.findUnique({
          where: { providerAccountId: input.providerAccountId },
          select: { tenantId: true },
        });
        if (billingAccount?.tenantId !== input.tenantId)
          throw new FeatureContractError(
            'FORBIDDEN',
            '課金provider accountとteamの紐付けを確認できません。',
            403,
          );
        const previousEvent = await tx.featureContractEvent.findUnique({
          where: {
            tenantId_eventId: {
              tenantId: input.tenantId,
              eventId: input.eventId,
            },
          },
        });
        if (previousEvent) {
          if (
            previousEvent.operation !== 'plan_sync' ||
            previousEvent.payloadHash !== hash
          )
            throw new FeatureContractError(
              'CONFLICT',
              '同じevent IDに異なる課金連携内容が指定されています。',
              409,
            );
          return;
        }
        const catalog = await tx.featurePlanDefinition.findUnique({
          where: { planKey: input.planKey },
          select: { featureKeys: true },
        });
        if (!catalog)
          throw new FeatureContractError(
            'NOT_FOUND',
            '指定されたプランがカタログにありません。',
            404,
          );
        const allowedFeatureKeys = new Set(catalog.featureKeys);
        if (
          featureKeys.some((featureKey) => !allowedFeatureKeys.has(featureKey))
        )
          throw new FeatureContractError(
            'FORBIDDEN',
            'プランで許可されていないfeature keyが含まれています。',
            403,
          );
        const definitions = await tx.featureDefinition.findMany({
          where: { key: { in: featureKeys } },
          select: { key: true },
        });
        if (definitions.length !== featureKeys.length)
          throw new FeatureContractError(
            'NOT_FOUND',
            'プランに未知のfeature keyが含まれています。',
            404,
          );
        const currentPlan = await tx.tenantPlan.findUnique({
          where: { tenantId: input.tenantId },
          select: { providerVersion: true },
        });
        if (currentPlan && currentPlan.providerVersion >= input.version)
          throw new FeatureContractError(
            'CONFLICT',
            '古い課金連携イベントは適用できません。',
            409,
          );
        await tx.featureContractEvent.create({
          data: {
            tenantId: input.tenantId,
            eventId: input.eventId,
            operation: 'plan_sync',
            version: input.version,
            payloadHash: hash,
          },
        });
        const plan = await tx.tenantPlan.upsert({
          where: { tenantId: input.tenantId },
          create: {
            tenantId: input.tenantId,
            planKey: input.planKey,
            status: input.status,
            featureKeys,
            billingProviderSubscriptionId: input.billingProviderSubscriptionId,
            providerVersion: input.version,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
          },
          update: {
            planKey: input.planKey,
            status: input.status,
            featureKeys,
            billingProviderSubscriptionId: input.billingProviderSubscriptionId,
            providerVersion: input.version,
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
              eventId: input.eventId,
              version: input.version,
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
      const hash = payloadHash({
        tenantId: input.tenantId,
        providerAccountId: input.providerAccountId,
        approvalId: input.approvalId,
        billingStatus: input.billingStatus,
        billingProviderSubscriptionId: input.billingProviderSubscriptionId,
        eventId: input.eventId,
        version: input.version,
        featureKey: input.featureKey,
        enabled: input.enabled,
        reason: input.reason,
        approvalTokenHash: secretHash(input.approvalToken),
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt?.toISOString() ?? null,
      });
      await client.$transaction(async (tx) => {
        await setRlsContext(tx, {
          tenantId: input.tenantId,
          userId: input.actorUserId,
          role: 'operator',
        });
        await lockTenant(tx, input.tenantId);
        const billingAccount = await tx.tenantBillingAccount.findUnique({
          where: { providerAccountId: input.providerAccountId },
          select: { tenantId: true },
        });
        if (billingAccount?.tenantId !== input.tenantId)
          throw new FeatureContractError(
            'FORBIDDEN',
            '課金providerアカウントとチームの紐付けを確認できません。',
            403,
          );
        const previousEvent = await tx.featureContractEvent.findUnique({
          where: {
            tenantId_eventId: {
              tenantId: input.tenantId,
              eventId: input.eventId,
            },
          },
        });
        if (previousEvent) {
          if (
            previousEvent.operation !== 'paid_grant' ||
            previousEvent.payloadHash !== hash
          )
            throw new FeatureContractError(
              'CONFLICT',
              '同じevent IDに異なる課金連携内容が指定されています。',
              409,
            );
          return;
        }
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
        const approval = await tx.featureGrantApproval.findUnique({
          where: {
            tenantId_id: {
              tenantId: input.tenantId,
              id: input.approvalId,
            },
          },
        });
        const now = new Date();
        if (
          approval?.status !== 'approved' ||
          approval.providerAccountId !== input.providerAccountId ||
          approval.featureKey !== input.featureKey ||
          secretHash(input.approvalToken) !== approval.approvalTokenHash ||
          approval.billingStatus !== input.billingStatus ||
          approval.billingProviderSubscriptionId !==
            input.billingProviderSubscriptionId ||
          approval.approvedAt > now ||
          (approval.expiresAt !== null && now >= approval.expiresAt) ||
          input.startsAt < approval.startsAt ||
          (approval.endsAt !== null &&
            (input.endsAt === null || input.endsAt > approval.endsAt))
        )
          throw new FeatureContractError(
            'FORBIDDEN',
            '有償featureの承認記録または課金状態を確認できません。',
            403,
          );
        const currentPlan = await tx.tenantPlan.findUnique({
          where: { tenantId: input.tenantId },
          select: {
            status: true,
            billingProviderSubscriptionId: true,
            startsAt: true,
            endsAt: true,
          },
        });
        if (
          !currentPlan ||
          currentPlan.status !== input.billingStatus ||
          currentPlan.billingProviderSubscriptionId !==
            input.billingProviderSubscriptionId ||
          currentPlan.startsAt > now ||
          (currentPlan.endsAt !== null && now >= currentPlan.endsAt)
        )
          throw new FeatureContractError(
            'FORBIDDEN',
            '現在の契約状態を確認できないため、有償featureを付与できません。',
            403,
          );
        const currentFlag = await tx.tenantFeatureFlag.findUnique({
          where: {
            tenantId_featureKey: {
              tenantId: input.tenantId,
              featureKey: input.featureKey,
            },
          },
          select: { providerVersion: true },
        });
        if (currentFlag && currentFlag.providerVersion >= input.version)
          throw new FeatureContractError(
            'CONFLICT',
            '古い課金連携イベントは適用できません。',
            409,
          );
        await tx.featureContractEvent.create({
          data: {
            tenantId: input.tenantId,
            eventId: input.eventId,
            operation: 'paid_grant',
            version: input.version,
            payloadHash: hash,
            approvalId: input.approvalId,
          },
        });
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
            providerVersion: input.version,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
          },
          update: {
            enabled: input.enabled,
            source: 'operator',
            changedByUserId: input.actorUserId,
            reason: input.reason,
            providerVersion: input.version,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
          },
        });
        await tx.featureGrantApproval.update({
          where: {
            tenantId_id: {
              tenantId: input.tenantId,
              id: input.approvalId,
            },
          },
          data: { status: 'consumed', consumedAt: new Date() },
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
              approvalId: input.approvalId,
              eventId: input.eventId,
              version: input.version,
            },
          },
        });
      });
    },
  };
}
