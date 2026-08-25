import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canChangeFeatureFlag,
  evaluateEffectiveFeatures,
  type FeatureDefinition,
} from '../dist/feature-contract.js';

const now = new Date('2026-08-25T00:00:00.000Z');
const definitions: FeatureDefinition[] = [
  {
    key: 'members',
    billingType: 'free',
    displayName: 'メンバー管理',
    defaultEnabled: true,
  },
  {
    key: 'orders',
    billingType: 'paid',
    displayName: '購買・集金',
    defaultEnabled: false,
  },
];

test('paid featureは有効なplanとfeature keyがなければ無効になる', () => {
  const [members, orders] = evaluateEffectiveFeatures({
    definitions,
    plan: {
      status: 'active',
      featureKeys: [],
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: null,
    },
    flags: [],
    now,
  });
  assert.equal(members?.enabled, true);
  assert.equal(orders?.enabled, false);
  assert.equal(orders?.reason, 'unavailable');
});

test('paid flagの有効化だけではplanなしで利用できない', () => {
  const [orders] = evaluateEffectiveFeatures({
    definitions: definitions.slice(1),
    plan: null,
    flags: [
      {
        featureKey: 'orders',
        enabled: true,
        source: 'admin',
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        endsAt: null,
      },
    ],
    now,
  });
  assert.equal(orders?.enabled, false);
  assert.equal(orders?.reason, 'unavailable');
});

test('paid flagはplanに含まれない機能を有効化できない', () => {
  const [orders] = evaluateEffectiveFeatures({
    definitions: definitions.slice(1),
    plan: {
      status: 'active',
      featureKeys: [],
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: null,
    },
    flags: [
      {
        featureKey: 'orders',
        enabled: true,
        source: 'admin',
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        endsAt: null,
      },
    ],
    now,
  });
  assert.equal(orders?.enabled, false);
  assert.equal(orders?.reason, 'unavailable');
});

test('approved operator grantはplanがなくてもpaid featureを有効化できる', () => {
  const [orders] = evaluateEffectiveFeatures({
    definitions: definitions.slice(1),
    plan: null,
    flags: [
      {
        featureKey: 'orders',
        enabled: true,
        source: 'operator',
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        endsAt: null,
      },
    ],
    now,
  });
  assert.equal(orders?.enabled, true);
  assert.equal(orders?.reason, 'flag');
});

test('無料機能の切り替えはownerとadminだけができる', () => {
  assert.equal(
    canChangeFeatureFlag({
      billingType: 'free',
      enabled: false,
      role: 'admin',
      source: 'admin',
      hasActivePlan: false,
    }),
    true,
  );
  assert.equal(
    canChangeFeatureFlag({
      billingType: 'free',
      enabled: false,
      role: 'staff',
      source: 'admin',
      hasActivePlan: false,
    }),
    false,
  );
});
