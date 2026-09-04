import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  createFeatureContractApp,
  createStaticFeatureContractOperatorAuth,
  createTenantGrantToken,
} from '../dist/features/feature-contract/feature-contract-app.js';

const TENANT_ID = '00000000-0000-7000-8000-000000000001';
const SYSTEM_OPERATOR_ID = 'system:feature-contract';
const SYSTEM_GRANT_ID = 'system:feature-grant';
const OPERATOR_TOKEN = 'operator-secret-that-is-long-enough-123456';
const GRANT_TOKEN = 'grant-secret-that-is-long-enough-123456';
const PROVIDER_SECRET = 'provider-secret-that-is-long-enough-123456';
const APPROVAL_TOKEN = 'approval-token-for-manual-grant-123456';

function providerSignature(body: string) {
  return createHmac('sha256', PROVIDER_SECRET).update(body).digest('hex');
}

const tenantGrantToken = createTenantGrantToken({
  grantToken: GRANT_TOKEN,
  tenantId: TENANT_ID,
});

type PlanCall = {
  actorUserId: string;
  tenantId: string;
  startsAt: Date;
};

type GrantCall = {
  actorUserId: string;
  featureKey: string;
  approvalId: string;
  approvalToken: string;
};

function createTestApp(calls: { plan?: PlanCall; grant?: GrantCall } = {}) {
  return createFeatureContractApp({
    repository: {
      get: async () => ({ planKey: null, planStatus: null, features: [] }),
      setFreeFlag: async () => ({
        planKey: null,
        planStatus: null,
        features: [],
      }),
      syncPlan: async (input) => {
        calls.plan = input;
      },
      grantPaidFeature: async (input) => {
        calls.grant = input;
      },
    },
    operatorAuth: createStaticFeatureContractOperatorAuth({
      token: OPERATOR_TOKEN,
      grantToken: GRANT_TOKEN,
      providerWebhookSecret: PROVIDER_SECRET,
    }),
    includeOperatorRoutes: true,
  });
}

test('公開listener用のfeature contract appにはoperator routeをmountしない', async () => {
  const app = createFeatureContractApp({
    repository: {
      get: async () => ({ planKey: null, planStatus: null, features: [] }),
      setFreeFlag: async () => ({
        planKey: null,
        planStatus: null,
        features: [],
      }),
      syncPlan: async () => {},
      grantPaidFeature: async () => {},
    },
    operatorAuth: createStaticFeatureContractOperatorAuth({
      token: OPERATOR_TOKEN,
      grantToken: GRANT_TOKEN,
      providerWebhookSecret: PROVIDER_SECRET,
    }),
  });
  const response = await app.request('/internal/feature-contract/paid-grant', {
    method: 'POST',
    body: '{}',
  });
  assert.equal(response.status, 404);
});

test('課金内部routeは正しいoperator secret以外を拒否する', async () => {
  const app = createTestApp();
  const response = await app.request('/internal/feature-contract/paid-grant', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-cocolo-grant-token': GRANT_TOKEN,
      'x-cocolo-approval-token': APPROVAL_TOKEN,
    },
    body: JSON.stringify({
      tenantId: TENANT_ID,
      providerAccountId: 'provider-account-123',
      approvalId: '00000000-0000-7000-8000-000000000002',
      billingStatus: 'active',
      billingProviderSubscriptionId: 'sub_123',
      eventId: 'manual.grant:invalid-token',
      version: 1,
      featureKey: 'orders-payments',
      enabled: true,
      reason: '契約同期',
      startsAt: '2026-08-26T00:00:00.000Z',
      endsAt: null,
    }),
  });
  assert.equal(response.status, 401);
});

test('課金内部routeは固定system principalでplan同期を監査する', async () => {
  const calls: { plan?: PlanCall } = {};
  const app = createTestApp(calls);
  const body = JSON.stringify({
    tenantId: TENANT_ID,
    providerAccountId: 'provider-account-123',
    eventId: 'subscription.updated:123',
    version: 1,
    planKey: 'standard',
    status: 'active',
    featureKeys: ['orders-payments'],
    billingProviderSubscriptionId: 'sub_123',
    startsAt: '2026-08-26T00:00:00.000Z',
    endsAt: null,
  });
  const response = await app.request('/internal/feature-contract/plan-sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-cocolo-operator-token': OPERATOR_TOKEN,
      'x-cocolo-provider-signature': providerSignature(body),
    },
    body,
  });
  assert.equal(response.status, 204);
  const plan = calls.plan;
  assert.ok(plan);
  assert.equal(plan.actorUserId, SYSTEM_OPERATOR_ID);
  assert.equal(plan.tenantId, TENANT_ID);
  assert.ok(plan.startsAt instanceof Date);
});

test('plan同期はprovider署名がなければrepositoryを呼ばない', async () => {
  let called = false;
  const app = createFeatureContractApp({
    repository: {
      get: async () => ({ planKey: null, planStatus: null, features: [] }),
      setFreeFlag: async () => ({
        planKey: null,
        planStatus: null,
        features: [],
      }),
      syncPlan: async () => {
        called = true;
      },
      grantPaidFeature: async () => {},
    },
    operatorAuth: createStaticFeatureContractOperatorAuth({
      token: OPERATOR_TOKEN,
      grantToken: GRANT_TOKEN,
      providerWebhookSecret: PROVIDER_SECRET,
    }),
    includeOperatorRoutes: true,
  });
  const body = JSON.stringify({
    tenantId: TENANT_ID,
    providerAccountId: 'provider-account-123',
    eventId: 'subscription.updated:invalid-signature',
    version: 1,
    planKey: 'standard',
    status: 'active',
    featureKeys: ['orders-payments'],
    billingProviderSubscriptionId: 'sub_123',
    startsAt: '2026-08-26T00:00:00.000Z',
    endsAt: null,
  });
  const response = await app.request('/internal/feature-contract/plan-sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-cocolo-operator-token': OPERATOR_TOKEN,
      'x-cocolo-provider-signature': 'invalid',
    },
    body,
  });
  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test('課金内部routeはpaid feature付与をsystem principalでrepositoryへ渡す', async () => {
  const calls: { grant?: GrantCall } = {};
  const app = createTestApp(calls);
  const response = await app.request('/internal/feature-contract/paid-grant', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-cocolo-grant-token': tenantGrantToken,
      'x-cocolo-approval-token': APPROVAL_TOKEN,
    },
    body: JSON.stringify({
      tenantId: TENANT_ID,
      providerAccountId: 'provider-account-123',
      approvalId: '00000000-0000-7000-8000-000000000002',
      billingStatus: 'active',
      billingProviderSubscriptionId: 'sub_123',
      eventId: 'manual.grant:123',
      version: 1,
      featureKey: 'orders-payments',
      enabled: true,
      reason: '契約同期',
      startsAt: '2026-08-26T00:00:00.000Z',
      endsAt: null,
    }),
  });
  assert.equal(response.status, 204);
  const grant = calls.grant;
  assert.ok(grant);
  assert.equal(grant.actorUserId, SYSTEM_GRANT_ID);
  assert.equal(grant.featureKey, 'orders-payments');
  assert.equal(grant.approvalId, '00000000-0000-7000-8000-000000000002');
  assert.equal(grant.approvalToken, APPROVAL_TOKEN);
});
