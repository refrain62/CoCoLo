import assert from 'node:assert/strict';
import test from 'node:test';
import {
  featureContractResponseSchema,
  featureFlagUpdateSchema,
  featurePlanSyncSchema,
  paidFeatureGrantSchema,
} from '../src/feature-contract.ts';

test('feature flag更新はenabledと理由以外を受け付けない', () => {
  assert.equal(
    featureFlagUpdateSchema.safeParse({ enabled: false, reason: '運用停止' })
      .success,
    true,
  );
  assert.equal(
    featureFlagUpdateSchema.safeParse({
      enabled: true,
      reason: '有効化',
      tenantId: '別tenant',
    }).success,
    false,
  );
});

test('feature契約responseはplanと機能の状態だけを公開する', () => {
  const result = featureContractResponseSchema.safeParse({
    data: {
      planKey: 'standard',
      planStatus: 'active',
      features: [
        {
          key: 'orders',
          billingType: 'paid',
          displayName: '購買・集金',
          enabled: true,
          reason: 'plan',
        },
      ],
    },
  });
  assert.equal(result.success, true);
});

test('課金連携の内部入力はtenant、期間、feature keyを厳密に検証する', () => {
  const base = {
    tenantId: '00000000-0000-7000-8000-000000000001',
    providerAccountId: 'provider-account-123',
    eventId: 'subscription.updated:123',
    version: 1,
    planKey: 'standard',
    status: 'active' as const,
    featureKeys: ['orders-payments'],
    billingProviderSubscriptionId: 'sub_123',
    startsAt: '2026-08-26T00:00:00.000Z',
    endsAt: null,
  };
  assert.equal(featurePlanSyncSchema.safeParse(base).success, true);
  assert.equal(
    featurePlanSyncSchema.safeParse({
      ...base,
      featureKeys: ['orders-payments', 'orders-payments'],
    }).success,
    false,
  );
  assert.equal(
    paidFeatureGrantSchema.safeParse({
      tenantId: base.tenantId,
      providerAccountId: base.providerAccountId,
      approvalId: '00000000-0000-7000-8000-000000000002',
      billingStatus: 'active',
      billingProviderSubscriptionId: base.billingProviderSubscriptionId,
      eventId: base.eventId,
      version: base.version,
      featureKey: 'orders-payments',
      enabled: true,
      reason: '契約同期',
      startsAt: base.startsAt,
      endsAt: base.endsAt,
    }).success,
    true,
  );
  assert.equal(
    paidFeatureGrantSchema.safeParse({
      tenantId: 'tenant-a',
      providerAccountId: base.providerAccountId,
      approvalId: '00000000-0000-7000-8000-000000000002',
      billingStatus: 'active',
      billingProviderSubscriptionId: base.billingProviderSubscriptionId,
      eventId: base.eventId,
      version: base.version,
      featureKey: 'orders-payments',
      enabled: true,
      reason: '契約同期',
      startsAt: base.startsAt,
      endsAt: base.endsAt,
    }).success,
    false,
  );
  assert.equal(
    paidFeatureGrantSchema.safeParse({
      tenantId: base.tenantId,
      providerAccountId: base.providerAccountId,
      approvalId: '00000000-0000-7000-8000-000000000002',
      billingStatus: 'past_due',
      billingProviderSubscriptionId: base.billingProviderSubscriptionId,
      eventId: base.eventId,
      version: base.version,
      featureKey: 'orders-payments',
      enabled: true,
      reason: '契約同期',
      startsAt: base.startsAt,
      endsAt: base.endsAt,
    }).success,
    false,
  );
  assert.equal(
    featurePlanSyncSchema.safeParse({
      ...base,
      billingProviderSubscriptionId: null,
    }).success,
    false,
  );
});
