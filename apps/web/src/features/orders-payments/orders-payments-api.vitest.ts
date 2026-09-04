import { afterEach, describe, expect, it } from 'vitest';
import { createOrdersPaymentsApi } from './orders-payments-api.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('共同購買API client', () => {
  it('注文登録へBearer tokenと冪等キーを送る', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = async (input, init) => {
      request = { url: String(input), init };
      return new Response(JSON.stringify({ data: { id: 'entry-1' } }), {
        status: 201,
      });
    };
    await createOrdersPaymentsApi({
      getAccessToken: () => 'token',
    }).createEntry('order-1', {
      subjectMemberId: 'member-1',
      ordererName: '注文者',
      lines: [
        {
          productId: 'product-1',
          quantity: 1,
          selectedOptions: {},
          backNumber: null,
          backName: null,
        },
      ],
    });
    expect(request?.url).toBe('/api/v1/orders/order-1/entries');
    expect(request?.init?.headers).toMatchObject({
      Authorization: 'Bearer token',
    });
    const requestHeaders = (request?.init?.headers ?? {}) as Record<
      string,
      string
    >;
    expect(requestHeaders['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('注文APIへ選択中チームIDを送る', async () => {
    let request: { init?: RequestInit } | undefined;
    globalThis.fetch = async (_input, init) => {
      request = { init };
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };
    await createOrdersPaymentsApi({
      getAccessToken: () => 'token',
      getSelectedTeamId: () => '00000000-0000-7000-8000-000000000001',
    }).listCampaigns();
    expect(request?.init?.headers).toMatchObject({
      'X-CoCoLo-Team-Id': '00000000-0000-7000-8000-000000000001',
    });
  });

  it('CSV出力はJSONとして解釈せずBlobを返す', async () => {
    globalThis.fetch = async () =>
      new Response('csv', {
        status: 200,
        headers: { 'content-type': 'text/csv' },
      });
    const blob = await createOrdersPaymentsApi({
      getAccessToken: () => 'token',
    }).exportCsv('order-1');
    expect(await blob.text()).toBe('csv');
  });
});
