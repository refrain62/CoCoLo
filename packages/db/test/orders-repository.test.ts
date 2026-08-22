import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInMemoryOrdersRepository,
  OrdersRepositoryError,
} from '../dist/orders-repository.js';

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const TENANT_B = '00000000-0000-7000-8000-000000000002';
const MEMBER_A = '00000000-0000-7000-8000-000000000201';
const MEMBER_B = '00000000-0000-7000-8000-000000000202';

const now = () => new Date('2026-08-22T00:00:00.000Z');
const campaignInput = {
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
};

function createRepository() {
  return createInMemoryOrdersRepository({
    now,
    members: [
      { id: MEMBER_A, tenantId: TENANT_A, name: '部員A', status: 'active' },
      { id: MEMBER_B, tenantId: TENANT_B, name: '部員B', status: 'active' },
    ],
    guardianAssignments: [
      { tenantId: TENANT_A, userId: 'guardian-a', memberId: MEMBER_A },
    ],
  });
}

function firstProduct(campaign) {
  const product = campaign.products[0];
  if (!product) throw new Error('テスト用商品がありません。');
  return product;
}

async function assertRepositoryError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof OrdersRepositoryError);
    assert.equal(error.code, code);
    return true;
  });
}

test('募集案件・商品はowner/adminだけが登録でき、別テナントから見えない', async () => {
  const repository = createRepository();
  const campaign = await repository.createCampaign(
    { tenantId: TENANT_A, actorUserId: 'owner-a', role: 'owner' },
    campaignInput,
  );

  await assertRepositoryError(
    repository.createCampaign(
      { tenantId: TENANT_A, actorUserId: 'staff-a', role: 'staff' },
      campaignInput,
    ),
    'FORBIDDEN',
  );
  await assertRepositoryError(
    repository.getCampaign({
      tenantId: TENANT_B,
      actorUserId: 'owner-b',
      role: 'owner',
      orderId: campaign.id,
    }),
    'NOT_FOUND',
  );
});

test('担当外部員と登録外選択肢を拒否し、登録済み商品だけを注文できる', async () => {
  const repository = createRepository();
  const campaign = await repository.createCampaign(
    { tenantId: TENANT_A, actorUserId: 'owner-a', role: 'owner' },
    campaignInput,
  );
  const product = firstProduct(campaign);

  await assertRepositoryError(
    repository.createEntry({
      tenantId: TENANT_A,
      actorUserId: 'guardian-a',
      role: 'guardian',
      orderId: campaign.id,
      entry: {
        memberId: MEMBER_B,
        ordererName: '注文者',
        lines: [
          {
            productId: product.id,
            quantity: 1,
            selectedOptions: { サイズ: 'M' },
            backNumber: '10',
          },
        ],
      },
    }),
    'NOT_FOUND',
  );

  await assertRepositoryError(
    repository.createEntry({
      tenantId: TENANT_A,
      actorUserId: 'guardian-a',
      role: 'guardian',
      orderId: campaign.id,
      entry: {
        memberId: MEMBER_A,
        ordererName: '注文者',
        lines: [
          {
            productId: product.id,
            quantity: 1,
            selectedOptions: { サイズ: 'XL' },
            backNumber: '10',
          },
        ],
      },
    }),
    'INVALID_INPUT',
  );

  const entry = await repository.createEntry({
    tenantId: TENANT_A,
    actorUserId: 'guardian-a',
    role: 'guardian',
    orderId: campaign.id,
    entry: {
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
    },
  });
  assert.equal(entry.totalAmount, 6000);
});

test('支払状態の変更を監査し、paidからunpaidへ戻せる', async () => {
  const repository = createRepository();
  const campaign = await repository.createCampaign(
    { tenantId: TENANT_A, actorUserId: 'owner-a', role: 'owner' },
    campaignInput,
  );
  const product = firstProduct(campaign);
  const entry = await repository.createEntry({
    tenantId: TENANT_A,
    actorUserId: 'guardian-a',
    role: 'guardian',
    orderId: campaign.id,
    entry: {
      memberId: MEMBER_A,
      ordererName: '注文者',
      lines: [
        {
          productId: product.id,
          quantity: 1,
          selectedOptions: { サイズ: 'S' },
          backNumber: '1',
        },
      ],
    },
  });
  const paid = await repository.updatePayment({
    tenantId: TENANT_A,
    actorUserId: 'admin-a',
    role: 'admin',
    orderId: campaign.id,
    entryId: entry.id,
    status: 'paid',
  });
  assert.equal(paid.paymentConfirmedBy, 'admin-a');
  assert.equal(paid.paymentConfirmedAt, now().toISOString());
  const unpaid = await repository.updatePayment({
    tenantId: TENANT_A,
    actorUserId: 'admin-a',
    role: 'admin',
    orderId: campaign.id,
    entryId: entry.id,
    status: 'unpaid',
  });
  assert.equal(unpaid.paymentConfirmedAt, null);
  const audits = await repository.listAuditLogs(TENANT_A);
  assert.equal(
    audits.filter((audit) => audit.action === 'orders.payment.update').length,
    2,
  );
  assert.equal(JSON.stringify(audits).includes('注文者'), false);
});

test('CSVは管理者だけが出力でき、BOMと式インジェクション対策を持つ', async () => {
  const repository = createRepository();
  const campaign = await repository.createCampaign(
    { tenantId: TENANT_A, actorUserId: 'owner-a', role: 'owner' },
    campaignInput,
  );
  const product = firstProduct(campaign);
  await repository.createEntry({
    tenantId: TENANT_A,
    actorUserId: 'guardian-a',
    role: 'guardian',
    orderId: campaign.id,
    entry: {
      memberId: MEMBER_A,
      ordererName: '=危険な名前',
      lines: [
        {
          productId: product.id,
          quantity: 1,
          selectedOptions: { サイズ: 'M' },
          backNumber: '2',
        },
      ],
    },
  });
  await assertRepositoryError(
    repository.exportCsv({
      tenantId: TENANT_A,
      actorUserId: 'staff-a',
      role: 'staff',
      orderId: campaign.id,
    }),
    'FORBIDDEN',
  );
  const csv = await repository.exportCsv({
    tenantId: TENANT_A,
    actorUserId: 'admin-a',
    role: 'admin',
    orderId: campaign.id,
  });
  assert.equal(csv.startsWith('\uFEFF'), true);
  assert.equal(csv.includes("'=危険な名前"), true);
});
