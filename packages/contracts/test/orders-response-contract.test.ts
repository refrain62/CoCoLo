import assert from 'node:assert/strict';
import test from 'node:test';
import {
  orderCampaignResponseEnvelopeSchema,
  orderEntryResponseEnvelopeSchemaForRole,
  orderSummaryResponseEnvelopeSchema,
} from '../src/orders-response-contract.ts';

const campaign = {
  id: '00000000-0000-7000-8000-000000000401',
  title: '冬季ユニフォーム',
  deadline: '2026-09-01T00:00:00.000Z',
  status: 'open',
  products: [
    {
      id: '00000000-0000-7000-8000-000000000402',
      name: 'シャツ',
      unitPrice: 3000,
      imageUrl: null,
      options: [{ name: 'サイズ', values: ['S', 'M'] }],
      requiresBackNumber: false,
      requiresBackName: false,
    },
  ],
  createdAt: '2026-08-22T00:00:00.000Z',
};
const PRODUCT_ID = '00000000-0000-7000-8000-000000000402';

const entry = {
  id: '00000000-0000-7000-8000-000000000403',
  campaignId: campaign.id,
  ordererName: '保護者A',
  memberId: '00000000-0000-7000-8000-000000000201',
  memberName: '部員A',
  lines: [
    {
      id: '00000000-0000-7000-8000-000000000404',
      productId: PRODUCT_ID,
      productName: 'シャツ',
      unitPrice: 3000,
      quantity: 1,
      selectedOptions: { サイズ: 'M' },
      backNumber: null,
      backName: null,
      amount: 3000,
    },
  ],
  totalAmount: 3000,
  paymentStatus: 'unpaid',
  paymentConfirmedAt: null,
  createdAt: '2026-08-22T00:00:00.000Z',
};

test('注文campaign responseはtenantを公開せず、余分な項目を拒否する', () => {
  assert.equal(
    orderCampaignResponseEnvelopeSchema.safeParse({
      data: { ...campaign, tenantId: 'tenant-a' },
    }).success,
    false,
  );
  assert.equal(
    orderCampaignResponseEnvelopeSchema.safeParse({ data: campaign }).success,
    true,
  );
});

test('注文entry responseはmanagerだけpaymentConfirmedByを公開する', () => {
  assert.equal(
    orderEntryResponseEnvelopeSchemaForRole('guardian').safeParse({
      data: { ...entry, paymentConfirmedBy: 'admin-a' },
    }).success,
    false,
  );
  assert.equal(
    orderEntryResponseEnvelopeSchemaForRole('admin').safeParse({
      data: { ...entry, paymentConfirmedBy: null },
    }).success,
    true,
  );
});

test('注文summary responseは集計項目を固定する', () => {
  assert.equal(
    orderSummaryResponseEnvelopeSchema.safeParse({
      data: {
        totalOrders: 1,
        totalAmount: 3000,
        paidAmount: 0,
        unpaidAmount: 3000,
        byProduct: [
          {
            productId: PRODUCT_ID,
            productName: 'シャツ',
            selectedOptions: { サイズ: 'M' },
            quantity: 1,
            amount: 3000,
          },
        ],
        unpaid: [
          {
            entryId: entry.id,
            ordererName: '保護者A',
            memberName: '部員A',
            amount: 3000,
          },
        ],
      },
    }).success,
    true,
  );
});
