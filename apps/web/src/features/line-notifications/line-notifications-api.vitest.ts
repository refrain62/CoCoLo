import { afterEach, describe, expect, it } from 'vitest';
import { createLineNotificationApi } from './line-notifications-api.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('LINE通知APIクライアント', () => {
  it('未接続状態をAPIから取得する', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = async (input, init) => {
      request = { url: String(input), init };
      return new Response(
        JSON.stringify({ data: { status: 'disconnected', groupId: null } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const status = await createLineNotificationApi({
      getAccessToken: () => 'token',
    }).status();

    expect(status.status).toBe('disconnected');
    expect(request?.url).toBe('/api/v1/line/status');
    expect(request?.init?.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer token',
    });
  });

  it('通知登録は認証トークン付きでdeep-linkを送る', async () => {
    let body: string | undefined;
    globalThis.fetch = async (_input, init) => {
      body = String(init?.body);
      return new Response(
        JSON.stringify({
          data: {
            status: 'queued',
            notification: {
              id: '00000000-0000-7000-8000-000000000001',
              sourceType: 'event',
              sourceId: 'event-001',
              status: 'pending',
              attempts: 0,
              nextRetryAt: null,
            },
          },
        }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      );
    };

    await createLineNotificationApi({ getAccessToken: () => 'token' }).enqueue({
      sourceType: 'event',
      sourceId: 'event-001',
      title: '予定',
      body: '本文',
      deepLink: 'https://staging.example.test/events/event-001',
    });

    expect(body).toBe(
      JSON.stringify({
        sourceType: 'event',
        sourceId: 'event-001',
        title: '予定',
        body: '本文',
        deepLink: 'https://staging.example.test/events/event-001',
      }),
    );
  });
});
