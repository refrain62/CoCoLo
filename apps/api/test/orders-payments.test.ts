import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryOrdersRepository } from '@cocolo/db/orders';
import type { OrdersRole } from '@cocolo/domain/orders';
import { Hono } from 'hono';
import {
  createOrdersPaymentsApp,
  type OrdersPaymentsApiEnv,
} from '../dist/features/orders-payments/orders-payments-app.js';

type OrdersPaymentsApp = ReturnType<typeof createOrdersPaymentsApp>;

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const TENANT_B = '00000000-0000-7000-8000-000000000002';
const MEMBER_A = '00000000-0000-7000-8000-000000000201';

const memberships: Record<string, { tenantId: string; role: OrdersRole }> = {
  'owner-a': { tenantId: TENANT_A, role: 'owner' },
  'admin-a': { tenantId: TENANT_A, role: 'admin' },
  'guardian-a': { tenantId: TENANT_A, role: 'guardian' },
  'staff-a': { tenantId: TENANT_A, role: 'staff' },
  'owner-b': { tenantId: TENANT_B, role: 'owner' },
};

function createTestApp(): OrdersPaymentsApp {
  const repository = createInMemoryOrdersRepository({
    now: () => new Date('2026-08-22T00:00:00.000Z'),
    members: [
      { id: MEMBER_A, tenantId: TENANT_A, name: '部員A', status: 'active' },
    ],
    guardianAssignments: [
      { tenantId: TENANT_A, userId: 'guardian-a', memberId: MEMBER_A },
    ],
  });
  return createOrdersPaymentsApp({
    verifyToken: async (token) => {
      if (!memberships[token]) throw new Error('invalid token');
      return {
        userId: token,
        issuer: 'https://example.supabase.co/auth/v1',
        audience: 'authenticated',
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      };
    },
    membershipRepository: {
      findActiveByUserId: async (userId) => memberships[userId] ?? null,
    },
    ordersRepository: repository,
  });
}

function createCentralTestApp(
  userId: string,
  tenantId: string,
  role: OrdersRole,
  repository = createInMemoryOrdersRepository({
    now: () => new Date('2026-08-22T00:00:00.000Z'),
    members: [
      { id: MEMBER_A, tenantId: TENANT_A, name: '部員A', status: 'active' },
    ],
    guardianAssignments: [
      { tenantId: TENANT_A, userId: 'guardian-a', memberId: MEMBER_A },
    ],
  }),
): OrdersPaymentsApp {
  const app = new Hono<OrdersPaymentsApiEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'central-request-id');
    c.header('x-request-id', c.get('requestId'));
    c.set('auth', { userId, membership: { tenantId, role } });
    await next();
  });
  app.route(
    '/',
    createOrdersPaymentsApp({
      ordersRepository: repository,
      useCentralAuth: true,
      // 中央接続時はfeature側のJWT・所属解決を呼び出さない。
      verifyToken: async () => {
        throw new Error('feature auth must not run');
      },
      membershipRepository: {
        findActiveByUserId: async () => {
          throw new Error('feature membership lookup must not run');
        },
      },
    }),
  );
  return app as unknown as OrdersPaymentsApp;
}

async function json(response: Response) {
  return response.json();
}

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

async function createCampaign(app: OrdersPaymentsApp) {
  const response = await app.request('/api/v1/orders', {
    method: 'POST',
    headers: { ...headers('owner-a'), 'idempotency-key': 'campaign-1' },
    body: JSON.stringify({
      title: '冬季ユニフォーム',
      deadline: '2026-09-01T00:00:00.000Z',
      products: [
        {
          name: 'シャツ',
          unitPrice: 3000,
          options: [{ name: 'サイズ', values: ['S', 'M'] }],
          requiresBackNumber: true,
          requiresBackName: false,
        },
      ],
    }),
  });
  assert.equal(response.status, 201);
  return (await json(response)).data;
}

test('未認証とstaffの管理操作を拒否する', async () => {
  const app = createTestApp();
  assert.equal((await app.request('/api/v1/orders')).status, 401);
  const staffList = await app.request('/api/v1/orders', {
    headers: headers('staff-a'),
  });
  assert.equal(staffList.status, 403);
  const response = await app.request('/api/v1/orders', {
    method: 'POST',
    headers: headers('staff-a'),
    body: JSON.stringify({
      title: '不正',
      deadline: '2026-09-01T00:00:00.000Z',
      products: [{ name: '商品', unitPrice: 1, options: [] }],
    }),
  });
  assert.equal(response.status, 403);
  assert.equal((await json(response)).error.code, 'FORBIDDEN');
});

test('中央authのselected tenantを利用し、guardian/staff権限とrequest-idを維持する', async () => {
  const repository = createInMemoryOrdersRepository({
    now: () => new Date('2026-08-22T00:00:00.000Z'),
    members: [
      { id: MEMBER_A, tenantId: TENANT_A, name: '部員A', status: 'active' },
    ],
    guardianAssignments: [
      { tenantId: TENANT_A, userId: 'guardian-a', memberId: MEMBER_A },
    ],
  });
  const ownerApp = createCentralTestApp(
    'owner-a',
    TENANT_A,
    'owner',
    repository,
  );
  const campaign = await createCampaign(ownerApp);

  const staffApp = createCentralTestApp(
    'staff-a',
    TENANT_A,
    'staff',
    repository,
  );
  const staffCreate = await staffApp.request('/api/v1/orders', {
    method: 'POST',
    headers: headers('a-token-is-ignored-by-central-auth'),
    body: JSON.stringify({
      title: 'staff cannot create',
      deadline: '2026-09-01T00:00:00.000Z',
      products: [{ name: '商品', unitPrice: 1, options: [] }],
    }),
  });
  assert.equal(staffCreate.status, 403);

  const guardianApp = createCentralTestApp(
    'guardian-a',
    TENANT_A,
    'guardian',
    repository,
  );
  const guardianCreate = await guardianApp.request(
    `/api/v1/orders/${campaign.id}/entries`,
    {
      method: 'POST',
      headers: headers('another-ignored-token'),
      body: JSON.stringify({
        memberId: MEMBER_A,
        ordererName: '中央認証の注文者',
        lines: [
          {
            productId: campaign.products[0].id,
            quantity: 1,
            selectedOptions: { サイズ: 'M' },
            backNumber: '10',
          },
        ],
      }),
    },
  );
  assert.equal(guardianCreate.status, 201);
  assert.equal(
    guardianCreate.headers.get('x-request-id'),
    'central-request-id',
  );
  assert.equal(
    'paymentConfirmedBy' in (await json(guardianCreate)).data,
    false,
  );

  const tenantBApp = createCentralTestApp(
    'owner-b',
    TENANT_B,
    'owner',
    repository,
  );
  const crossTenant = await tenantBApp.request(
    `/api/v1/orders/${campaign.id}`,
    { headers: headers('owner-a-token-is-ignored-by-central-auth') },
  );
  assert.equal(crossTenant.status, 404);
});

test('募集案件を作成し、guardianの注文と登録外選択肢拒否を処理する', async () => {
  const app = createTestApp();
  const campaign = await createCampaign(app);
  const product = campaign.products[0];

  const invalid = await app.request(`/api/v1/orders/${campaign.id}/entries`, {
    method: 'POST',
    headers: headers('guardian-a'),
    body: JSON.stringify({
      subjectMemberId: MEMBER_A,
      ordererName: '注文者',
      lines: [
        {
          productId: product.id,
          quantity: 1,
          selectedOptions: { サイズ: 'XL' },
          backNumber: '10',
        },
      ],
    }),
  });
  assert.equal(invalid.status, 400);

  const created = await app.request(`/api/v1/orders/${campaign.id}/entries`, {
    method: 'POST',
    headers: { ...headers('guardian-a'), 'idempotency-key': 'entry-1' },
    body: JSON.stringify({
      memberId: MEMBER_A,
      ordererName: '注文者',
      lines: [
        {
          productId: product.id,
          quantity: 2,
          selectedOptions: { サイズ: 'M' },
          backNumber: '10',
        },
      ],
    }),
  });
  assert.equal(created.status, 201);
  assert.equal((await json(created)).data.totalAmount, 6000);
});

test('注文者の越境を防ぎ、支払状態・集計・CSVを管理者に限定する', async () => {
  const app = createTestApp();
  const campaign = await createCampaign(app);
  const product = campaign.products[0];
  const created = await app.request(`/api/v1/orders/${campaign.id}/entries`, {
    method: 'POST',
    headers: headers('guardian-a'),
    body: JSON.stringify({
      memberId: MEMBER_A,
      ordererName: '=式として解釈しない',
      lines: [
        {
          productId: product.id,
          quantity: 1,
          selectedOptions: { サイズ: 'S' },
          backNumber: '1',
        },
      ],
    }),
  });
  const entry = (await json(created)).data;

  const crossTenant = await app.request(`/api/v1/orders/${campaign.id}`, {
    headers: headers('owner-b'),
  });
  assert.equal(crossTenant.status, 404);

  const paid = await app.request(
    `/api/v1/orders/${campaign.id}/entries/${entry.id}/payment`,
    {
      method: 'PATCH',
      headers: { ...headers('admin-a'), 'idempotency-key': 'payment-1' },
      body: JSON.stringify({ status: 'paid' }),
    },
  );
  assert.equal(paid.status, 200);
  assert.equal((await json(paid)).data.paymentConfirmedBy, 'admin-a');

  const summary = await app.request(`/api/v1/orders/${campaign.id}/summary`, {
    headers: headers('admin-a'),
  });
  assert.equal(summary.status, 200);
  assert.equal((await json(summary)).data.paidAmount, 3000);

  const csv = await app.request(`/api/v1/orders/${campaign.id}/export.csv`, {
    headers: headers('admin-a'),
  });
  assert.equal(csv.status, 200);
  assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
  const csvBytes = new Uint8Array(await csv.arrayBuffer());
  assert.deepEqual([...csvBytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const csvText = new TextDecoder().decode(csvBytes);
  assert.ok(csvText.includes("'=式として解釈しない"));

  const staffCsv = await app.request(
    `/api/v1/orders/${campaign.id}/export.csv`,
    { headers: headers('staff-a') },
  );
  assert.equal(staffCsv.status, 403);
});

test('すべての注文URLでUUIDv7でないorderIdをDB処理前に拒否する', async () => {
  const app = createTestApp();
  const invalidOrderId = 'not-a-uuidv7';
  const requests = [
    { method: 'GET', path: `/api/v1/orders/${invalidOrderId}` },
    {
      method: 'POST',
      path: `/api/v1/orders/${invalidOrderId}/products`,
      body: '{}',
    },
    {
      method: 'PATCH',
      path: `/api/v1/orders/${invalidOrderId}/status`,
      body: JSON.stringify({ status: 'closed' }),
    },
    {
      method: 'GET',
      path: `/api/v1/orders/${invalidOrderId}/entries`,
    },
    {
      method: 'POST',
      path: `/api/v1/orders/${invalidOrderId}/entries`,
      body: '{}',
    },
    {
      method: 'GET',
      path: `/api/v1/orders/${invalidOrderId}/summary`,
    },
    {
      method: 'GET',
      path: `/api/v1/orders/${invalidOrderId}/unpaid`,
    },
    {
      method: 'GET',
      path: `/api/v1/orders/${invalidOrderId}/export.csv`,
    },
  ];

  for (const request of requests) {
    const response = await app.request(request.path, {
      method: request.method,
      headers: headers('admin-a'),
      body: request.body,
    });
    assert.equal(response.status, 400, request.path);
    assert.equal((await json(response)).error.code, 'VALIDATION_ERROR');
  }
});

test('支払URLでUUIDv7でないentryIdをDB処理前に拒否する', async () => {
  const app = createTestApp();
  const campaign = await createCampaign(app);
  const response = await app.request(
    `/api/v1/orders/${campaign.id}/entries/not-a-uuidv7/payment`,
    {
      method: 'PATCH',
      headers: headers('admin-a'),
      body: JSON.stringify({ status: 'paid' }),
    },
  );

  assert.equal(response.status, 400);
  assert.equal((await json(response)).error.code, 'VALIDATION_ERROR');
});
