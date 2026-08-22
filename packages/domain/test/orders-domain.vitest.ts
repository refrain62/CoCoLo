import { describe, expect, it } from 'vitest';
import {
  calculateLineAmount,
  createOrdersCsv,
  summarizeOrders,
  validateOrderSelection,
  validateProduct,
} from '../src/orders-domain.js';

describe('共同購買の業務ルール', () => {
  it('単価と数量を整数で計算する', () => {
    expect(calculateLineAmount(1200, 3)).toBe(3600);
  });

  it('登録済み選択肢以外を拒否する', () => {
    const product = validateProduct({
      name: 'ユニフォーム',
      unitPrice: 3000,
      options: [{ name: 'サイズ', values: ['S', 'M'] }],
    });
    expect(() =>
      validateOrderSelection(product, {
        quantity: 1,
        selectedOptions: { サイズ: 'XL' },
      }),
    ).toThrow('登録済みでない選択肢');
  });

  it('集計は商品と選択肢ごとに数量を分ける', () => {
    const common = {
      tenantId: 'tenant-a',
      campaignId: 'campaign-a',
      ordererUserId: 'guardian-a',
      ordererName: '山田 太郎',
      memberId: 'member-a',
      memberName: '山田 花子',
      paymentStatus: 'unpaid' as const,
      paymentConfirmedAt: null,
      paymentConfirmedBy: null,
      createdAt: '2026-08-22T00:00:00.000Z',
    };
    const summary = summarizeOrders([
      {
        ...common,
        id: 'order-a',
        totalAmount: 3000,
        lines: [
          {
            id: 'line-a',
            productId: 'product-a',
            productName: 'シャツ',
            unitPrice: 1500,
            quantity: 2,
            selectedOptions: { サイズ: 'M' },
            backNumber: null,
            backName: null,
            amount: 3000,
          },
        ],
      },
    ]);
    expect(summary.unpaidAmount).toBe(3000);
    expect(summary.byProduct[0]).toMatchObject({ quantity: 2, amount: 3000 });
  });

  it('CSVへBOMを付け、式として解釈される値を文字列化する', () => {
    const csv = createOrdersCsv([
      {
        orderId: 'order-a',
        campaignTitle: '共同購入',
        ordererName: '=危険',
        memberName: '山田 花子',
        productName: 'シャツ',
        selectedOptions: 'サイズ=M',
        quantity: 1,
        unitPrice: 1000,
        amount: 1000,
        paymentStatus: '未払い',
        paymentConfirmedAt: '',
      },
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain("'=危険");
  });
});
