import assert from 'node:assert/strict';
import test from 'node:test';
import {
  featureContractResponseSchema,
  featureFlagUpdateSchema,
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
