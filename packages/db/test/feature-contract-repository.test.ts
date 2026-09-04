import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  createFeatureContractRepository,
  FeatureContractError,
} from '../dist/feature-contract-repository.js';

test('plan同期は未知のfeature keyを保存前に拒否する', async () => {
  const tx = {
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
    featureContractEvent: {
      findUnique: async () => null,
    },
    featurePlanDefinition: {
      findUnique: async () => ({ featureKeys: ['orders-payments'] }),
    },
    tenantBillingAccount: {
      findUnique: async () => ({
        tenantId: '00000000-0000-7000-8000-000000000001',
      }),
    },
    featureDefinition: {
      findMany: async () => [],
    },
  } as unknown as Prisma.TransactionClient;
  const client = {
    $transaction: async (
      callback: (transaction: Prisma.TransactionClient) => Promise<unknown>,
    ) => callback(tx),
  } as unknown as PrismaClient;
  const repository = createFeatureContractRepository(client);

  await assert.rejects(
    repository.syncPlan({
      tenantId: '00000000-0000-7000-8000-000000000001',
      actorUserId: 'billing-operator',
      providerAccountId: 'provider-account-123',
      eventId: 'subscription.updated:123',
      version: 1,
      planKey: 'standard',
      status: 'active',
      featureKeys: ['orders-payments'],
      billingProviderSubscriptionId: 'sub_123',
      startsAt: new Date('2026-08-26T00:00:00.000Z'),
      endsAt: null,
    }),
    (error: unknown) =>
      error instanceof FeatureContractError && error.code === 'NOT_FOUND',
  );
});

test('plan同期は同じeventを冪等に処理し、古いversionを拒否する', async () => {
  let previousEvent: { payloadHash: string } | null = null;
  let currentPlan: { providerVersion: number } | null = null;
  let eventCreateCount = 0;
  const tx = {
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
    featureContractEvent: {
      findUnique: async () => previousEvent,
      create: async (input: { data: { payloadHash: string } }) => {
        eventCreateCount += 1;
        previousEvent = input.data;
      },
    },
    featurePlanDefinition: {
      findUnique: async () => ({ featureKeys: ['orders-payments'] }),
    },
    tenantBillingAccount: {
      findUnique: async () => ({
        tenantId: '00000000-0000-7000-8000-000000000001',
      }),
    },
    featureDefinition: {
      findMany: async () => [{ key: 'orders-payments' }],
    },
    tenantPlan: {
      findUnique: async () => currentPlan,
      upsert: async (input: {
        create: { providerVersion: number };
        update: { providerVersion: number };
      }) => {
        currentPlan = { providerVersion: input.create.providerVersion };
        return { id: '00000000-0000-7000-8000-000000000002' };
      },
    },
    auditLog: { create: async () => {} },
  } as unknown as Prisma.TransactionClient;
  const client = {
    $transaction: async (
      callback: (transaction: Prisma.TransactionClient) => Promise<unknown>,
    ) => callback(tx),
  } as unknown as PrismaClient;
  const repository = createFeatureContractRepository(client);
  const input = {
    tenantId: '00000000-0000-7000-8000-000000000001',
    actorUserId: 'system:feature-contract',
    providerAccountId: 'provider-account-123',
    eventId: 'subscription.updated:123',
    version: 1,
    planKey: 'standard',
    status: 'active' as const,
    featureKeys: ['orders-payments'],
    billingProviderSubscriptionId: 'sub_123',
    startsAt: new Date('2026-08-26T00:00:00.000Z'),
    endsAt: null,
  };

  await repository.syncPlan(input);
  await repository.syncPlan(input);
  assert.equal(eventCreateCount, 1);
  await assert.rejects(
    repository.syncPlan({ ...input, eventId: 'subscription.updated:122' }),
    (error: unknown) =>
      error instanceof FeatureContractError && error.code === 'CONFLICT',
  );
});

test('paid grantはprovider紐付けと未消費の承認台帳を要求する', async () => {
  const approvalToken = 'approval-token-for-manual-grant-123456';
  let approvalStatus = 'approved';
  let currentPlanStatus = 'active';
  let approvalUpdate: unknown;
  const tx = {
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
    tenantBillingAccount: {
      findUnique: async () => ({
        tenantId: '00000000-0000-7000-8000-000000000001',
      }),
    },
    featureContractEvent: {
      findUnique: async () => null,
      create: async () => {},
    },
    featureDefinition: {
      findUnique: async () => ({ billingType: 'paid' }),
    },
    featureGrantApproval: {
      findUnique: async () => ({
        status: approvalStatus,
        providerAccountId: 'provider-account-123',
        featureKey: 'orders-payments',
        approvalTokenHash: createHash('sha256')
          .update(approvalToken)
          .digest('hex'),
        billingStatus: 'active',
        billingProviderSubscriptionId: 'sub_123',
        approvedAt: new Date('2026-08-25T00:00:00.000Z'),
        startsAt: new Date('2026-08-25T00:00:00.000Z'),
        expiresAt: null,
        endsAt: null,
      }),
      update: async (input: unknown) => {
        approvalStatus = 'consumed';
        approvalUpdate = input;
      },
    },
    tenantFeatureFlag: {
      findUnique: async () => null,
      upsert: async () => {},
    },
    tenantPlan: {
      findUnique: async () => ({
        status: currentPlanStatus,
        billingProviderSubscriptionId: 'sub_123',
        startsAt: new Date('2026-08-25T00:00:00.000Z'),
        endsAt: null,
      }),
    },
    auditLog: { create: async () => {} },
  } as unknown as Prisma.TransactionClient;
  const client = {
    $transaction: async (
      callback: (transaction: Prisma.TransactionClient) => Promise<unknown>,
    ) => callback(tx),
  } as unknown as PrismaClient;
  const repository = createFeatureContractRepository(client);
  const input = {
    tenantId: '00000000-0000-7000-8000-000000000001',
    actorUserId: 'system:feature-grant',
    providerAccountId: 'provider-account-123',
    approvalId: '00000000-0000-7000-8000-000000000002',
    billingStatus: 'active' as const,
    billingProviderSubscriptionId: 'sub_123',
    approvalToken,
    eventId: 'manual.grant:123',
    version: 1,
    featureKey: 'orders-payments',
    enabled: true,
    reason: '承認済みの例外付与',
    startsAt: new Date('2026-08-26T00:00:00.000Z'),
    endsAt: null,
  };

  await repository.grantPaidFeature(input);
  assert.equal(approvalStatus, 'consumed');
  assert.deepEqual((approvalUpdate as { where: unknown }).where, {
    tenantId_id: {
      tenantId: input.tenantId,
      id: input.approvalId,
    },
  });
  assert.equal(
    (approvalUpdate as { data: { status: string; consumedAt: Date } }).data
      .status,
    'consumed',
  );
  assert.ok(
    (approvalUpdate as { data: { consumedAt: Date } }).data
      .consumedAt instanceof Date,
  );
  await assert.rejects(
    repository.grantPaidFeature({
      ...input,
      eventId: 'manual.grant:124',
      version: 2,
    }),
    (error: unknown) =>
      error instanceof FeatureContractError && error.code === 'FORBIDDEN',
  );
  approvalStatus = 'approved';
  currentPlanStatus = 'canceled';
  await assert.rejects(
    repository.grantPaidFeature({
      ...input,
      eventId: 'manual.grant:125',
      version: 3,
    }),
    (error: unknown) =>
      error instanceof FeatureContractError && error.code === 'FORBIDDEN',
  );
});
