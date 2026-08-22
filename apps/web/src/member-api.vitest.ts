import { afterEach, describe, expect, it } from 'vitest';
import { createMemberApi } from './member-api.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('年度繰り上げAPIクライアント', () => {
  it('プレビューは年度だけを JSON で送信する', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = async (input, init) => {
      request = { url: String(input), init };
      return new Response(
        JSON.stringify({
          data: {
            mode: 'preview',
            fiscalYear: 2026,
            status: 'preview',
            previewCount: 2,
            promotedCount: 2,
            result: null,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    await createMemberApi({ getAccessToken: () => 'token' }).promote({
      mode: 'preview',
      fiscalYear: 2026,
    });

    expect(request?.url).toBe('/api/v1/members/promote');
    expect(request?.init?.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    });
    expect(request?.init?.body).toBe(
      JSON.stringify({ mode: 'preview', fiscalYear: 2026 }),
    );
  });

  it('実行モードは Idempotency-Key をヘッダーへ渡す', async () => {
    let headers: HeadersInit | undefined;
    globalThis.fetch = async (_input, init) => {
      headers = init?.headers;
      return new Response(
        JSON.stringify({
          data: {
            mode: 'execute',
            fiscalYear: 2026,
            status: 'completed',
            previewCount: 2,
            promotedCount: 2,
            result: {},
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    await createMemberApi({ getAccessToken: () => 'token' }).promote(
      { mode: 'execute', fiscalYear: 2026 },
      'promotion-key',
    );

    expect(headers).toMatchObject({ 'Idempotency-Key': 'promotion-key' });
  });
});

describe('部員ライフサイクルAPIクライアント', () => {
  it('編集は部員IDをURLへエンコードしてPATCHする', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = async (input, init) => {
      request = { url: String(input), init };
      return new Response(
        JSON.stringify({
          data: {
            id: 'member/1',
            name: '更新後',
            kana: null,
            category: 'adult',
            gradeLevel: null,
            ageGroup: '30代',
            status: 'active',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    await createMemberApi({ getAccessToken: () => 'token' }).update(
      'member/1',
      {
        name: '更新後',
        category: 'adult',
        ageGroup: '30代',
        status: 'active',
      },
    );

    expect(request?.url).toBe('/api/v1/members/member%2F1');
    expect(request?.init?.method).toBe('PATCH');
  });

  it('退部は専用エンドポイントへPOSTする', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = async (input, init) => {
      request = { url: String(input), init };
      return new Response(
        JSON.stringify({
          data: {
            id: 'member-1',
            name: '退部部員',
            kana: null,
            category: 'adult',
            gradeLevel: null,
            ageGroup: '30代',
            status: 'retired',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    await createMemberApi({ getAccessToken: () => 'token' }).retire('member-1');

    expect(request?.url).toBe('/api/v1/members/member-1/retire');
    expect(request?.init?.method).toBe('POST');
  });
});
