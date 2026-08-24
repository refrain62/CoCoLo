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
    let url: string | undefined;
    let headers: Headers | undefined;
    let body: string | undefined;
    globalThis.fetch = async (input, init) => {
      url = String(input);
      headers = new Headers(init?.headers);
      body = String(init?.body);
      return new Response(
        JSON.stringify({
          data: {
            notificationId: '00000000-0000-7000-8000-000000000001',
            status: 'pending',
          },
        }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      );
    };

    await createLineNotificationApi({ getAccessToken: () => 'token' }).enqueue({
      sourceId: 'event-001',
      destination: 'Cgroup-001',
      title: '予定',
      body: '本文',
      deepLink: 'https://staging.example.test/events/event-001',
    });

    expect(url).toBe('/api/v1/notifications/line');
    expect(headers?.get('Authorization')).toBe('Bearer token');
    expect(headers?.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toBe(
      JSON.stringify({
        sourceId: 'event-001',
        destination: 'Cgroup-001',
        title: '予定',
        body: '本文',
        deepLink: 'https://staging.example.test/events/event-001',
      }),
    );
  });

  it('選択中チームを中央APIのheaderへ渡す', async () => {
    let headers: Headers | undefined;
    globalThis.fetch = async (_input, init) => {
      headers = new Headers(init?.headers);
      return new Response(
        JSON.stringify({ data: { status: 'disconnected', groupId: null } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    await createLineNotificationApi({
      getAccessToken: () => 'token',
      getSelectedTeamId: () => '00000000-0000-7000-8000-000000000001',
    }).status();

    expect(headers?.get('X-CoCoLo-Team-Id')).toBe(
      '00000000-0000-7000-8000-000000000001',
    );
  });
});
