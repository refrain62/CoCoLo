import { describe, expect, it } from 'vitest';
import { AuthApiError, createAuthClient } from './auth-client.js';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Supabase Auth client', () => {
  it('password grantの応答からセッションを作る', async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const client = createAuthClient({
      baseUrl: 'https://example.supabase.co',
      anonKey: 'public-anon-key',
      fetcher: async (input, init) => {
        request = { url: String(input), init: init ?? {} };
        return response({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
        });
      },
    });

    const session = await client.signInWithPassword(
      'member@example.com',
      'password-for-test',
    );

    expect(request?.url).toBe(
      'https://example.supabase.co/auth/v1/token?grant_type=password',
    );
    expect(request?.init.headers).toEqual({
      Accept: 'application/json',
      apikey: 'public-anon-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(request?.init.body))).toEqual({
      email: 'member@example.com',
      password: 'password-for-test',
    });
    expect(session).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    expect(session.expiresAt).toBeTypeOf('number');
  });

  it('refresh grantで更新トークンを送り、ローテーション後の値を保持する', async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const client = createAuthClient({
      baseUrl: 'https://example.supabase.co',
      anonKey: 'public-anon-key',
      fetcher: async (input, init) => {
        request = { url: String(input), init: init ?? {} };
        return response({
          access_token: 'next-access-token',
          refresh_token: 'next-refresh-token',
          expires_at: 1_900_000_000,
        });
      },
    });

    await expect(client.refreshSession('current-refresh-token')).resolves.toEqual(
      {
        accessToken: 'next-access-token',
        refreshToken: 'next-refresh-token',
        expiresAt: 1_900_000_000,
      },
    );
    expect(request?.url).toContain('grant_type=refresh_token');
    expect(JSON.parse(String(request?.init.body))).toEqual({
      refresh_token: 'current-refresh-token',
    });
    expect(JSON.stringify(request)).not.toContain('password-for-test');
  });

  it('logoutはaccess tokenだけをAuthorizationへ渡す', async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const client = createAuthClient({
      baseUrl: 'https://example.supabase.co',
      anonKey: 'public-anon-key',
      fetcher: async (input, init) => {
        request = { url: String(input), init: init ?? {} };
        return new Response(null, { status: 204 });
      },
    });

    await client.signOut('access-token-to-revoke');

    expect(request?.url).toBe('https://example.supabase.co/auth/v1/logout');
    expect(request?.init.headers).toEqual({
      Accept: 'application/json',
      apikey: 'public-anon-key',
      Authorization: 'Bearer access-token-to-revoke',
    });
    expect(request?.init.body).toBeUndefined();
  });

  it('Auth providerのエラー本文を例外メッセージへ含めない', async () => {
    const secret = 'refresh-token-that-must-not-leak';
    const client = createAuthClient({
      baseUrl: 'https://example.supabase.co',
      anonKey: 'public-anon-key',
      fetcher: async () =>
        response({ error_description: `invalid: ${secret}` }, 400),
    });

    const error = await client.refreshSession(secret).catch((value) => value);

    expect(error).toBeInstanceOf(AuthApiError);
    expect(error.message).not.toContain(secret);
    expect(error.message).toBe(
      'セッションを更新できませんでした。再ログインしてください。',
    );
  });
});
