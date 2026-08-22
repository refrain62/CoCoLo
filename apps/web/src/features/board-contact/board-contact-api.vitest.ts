import { afterEach, describe, expect, it } from 'vitest';
import { createBoardContactApi } from './board-contact-api.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('役員連絡先APIクライアント', () => {
  it('一覧取得にtokenと年度を渡す', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = async (input, init) => {
      request = { url: String(input), init };
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    await createBoardContactApi({ getAccessToken: () => 'token' }).list(2026);

    expect(request?.url).toBe('/api/v1/board-members?fiscalYear=2026');
    expect(request?.init?.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer token',
    });
  });

  it('登録・更新は入力をJSONへ変換し、IDをURLエンコードする', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          data: {
            id: 'board-1',
            fiscalYear: 2026,
            roleName: '会計',
            roleType: 'admin',
            contactPreference: 'phone',
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-01T00:00:00.000Z',
          },
        }),
        { status: 200 },
      );
    };
    const api = createBoardContactApi({ getAccessToken: () => 'token' });
    const input = {
      fiscalYear: 2026,
      roleName: '会計',
      roleType: 'admin' as const,
      phone: '090-0000-0000',
      contactPreference: 'phone' as const,
    };

    await api.create(input);
    await api.update('board/contact', { phone: null });

    expect(requests[0]?.url).toBe('/api/v1/board-members');
    expect(requests[0]?.init?.body).toBe(JSON.stringify(input));
    expect(requests[1]?.url).toBe('/api/v1/board-members/board%2Fcontact');
    expect(requests[1]?.init?.body).toBe(JSON.stringify({ phone: null }));
  });

  it('tokenがなければfetchを呼ばず401にする', async () => {
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return new Response(null, { status: 500 });
    };

    await expect(
      createBoardContactApi({ getAccessToken: () => null }).list(),
    ).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(called).toBe(false);
  });
});
