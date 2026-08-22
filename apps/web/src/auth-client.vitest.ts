import { describe, expect, it, vi } from 'vitest';
import { AuthApiError, createAuthClient } from './auth-client.js';
import { createAuthSessionManager } from './auth-context.js';

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

    await expect(
      client.refreshSession('current-refresh-token'),
    ).resolves.toEqual({
      accessToken: 'next-access-token',
      refreshToken: 'next-refresh-token',
      expiresAt: 1_900_000_000,
    });
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

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
    has(key: string) {
      return values.has(key);
    },
  };
}

const baseSession = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: null,
};

describe('Auth session manager', () => {
  it('期限前にrefreshし、保存済みtokenとBearerを更新する', async () => {
    const storage = createStorage({
      'cocolo.accessToken': 'old-access-token',
      'cocolo.refreshToken': 'old-refresh-token',
      'cocolo.expiresAt': '1010',
    });
    let refreshCount = 0;
    let requestHeaders: Headers | undefined;
    const manager = createAuthSessionManager({
      storage,
      now: () => 1_000_000,
      client: {
        signInWithPassword: async () => baseSession,
        refreshSession: async () => {
          refreshCount += 1;
          return {
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
            expiresAt: 4_600,
          };
        },
        signOut: async () => undefined,
      },
      requester: async (_input, init) => {
        requestHeaders = new Headers(init?.headers);
        return new Response('{}', { status: 200 });
      },
    });

    await manager.authenticatedFetch('/api/v1/members');

    expect(refreshCount).toBe(1);
    expect(requestHeaders?.get('Authorization')).toBe(
      'Bearer new-access-token',
    );
    expect(storage.getItem('cocolo.refreshToken')).toBe('new-refresh-token');
  });

  it('同時に401を受けてもrefreshを一度だけ実行して各要求を一度再送する', async () => {
    const storage = createStorage({
      'cocolo.accessToken': baseSession.accessToken,
      'cocolo.refreshToken': baseSession.refreshToken ?? '',
    });
    let refreshCount = 0;
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const requestHeaders: string[] = [];
    let requestCount = 0;
    const manager = createAuthSessionManager({
      storage,
      client: {
        signInWithPassword: async () => baseSession,
        refreshSession: async () => {
          refreshCount += 1;
          await refreshGate;
          return {
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
            expiresAt: null,
          };
        },
        signOut: async () => undefined,
      },
      requester: async (_input, init) => {
        requestCount += 1;
        requestHeaders.push(
          new Headers(init?.headers).get('Authorization') ?? '',
        );
        return new Response('{}', { status: requestCount <= 2 ? 401 : 200 });
      },
    });

    const first = manager.authenticatedFetch('/api/v1/members');
    const second = manager.authenticatedFetch('/api/v1/members');
    await vi.waitFor(() => expect(refreshCount).toBe(1));
    releaseRefresh();
    await Promise.all([first, second]);

    expect(requestCount).toBe(4);
    expect(requestHeaders.slice(0, 2)).toEqual([
      'Bearer access-token',
      'Bearer access-token',
    ]);
    expect(requestHeaders.slice(2)).toEqual([
      'Bearer new-access-token',
      'Bearer new-access-token',
    ]);
  });

  it('refresh失敗時はsessionと保存領域を消去し、再ログイン要求を通知する', async () => {
    const secret = 'refresh-secret';
    const storage = createStorage({
      'cocolo.accessToken': 'access-secret',
      'cocolo.refreshToken': secret,
      'cocolo.expiresAt': '1000',
    });
    let expiredCount = 0;
    const manager = createAuthSessionManager({
      storage,
      onSessionExpired: () => {
        expiredCount += 1;
      },
      client: {
        signInWithPassword: async () => baseSession,
        refreshSession: async () => {
          throw new Error(`provider response contains ${secret}`);
        },
        signOut: async () => undefined,
      },
    });

    await expect(manager.refresh()).resolves.toBeNull();

    expect(manager.getSession()).toBeNull();
    expect(storage.has('cocolo.accessToken')).toBe(false);
    expect(storage.has('cocolo.refreshToken')).toBe(false);
    expect(storage.has('cocolo.expiresAt')).toBe(false);
    expect(expiredCount).toBe(1);
  });

  it('logoutはリモート失敗時も先にsessionとtokenを消去する', async () => {
    const storage = createStorage({
      'cocolo.accessToken': 'access-secret',
      'cocolo.refreshToken': 'refresh-secret',
    });
    const manager = createAuthSessionManager({
      storage,
      client: {
        signInWithPassword: async () => baseSession,
        refreshSession: async () => baseSession,
        signOut: async () => {
          throw new Error('remote error includes access-secret');
        },
      },
    });

    const error = await manager.logout().catch((value) => value);

    expect(manager.getSession()).toBeNull();
    expect(storage.has('cocolo.accessToken')).toBe(false);
    expect(storage.has('cocolo.refreshToken')).toBe(false);
    expect(error).toMatchObject({ message: 'ログアウトに失敗しました。' });
    expect(error.message).not.toContain('access-secret');
  });
});
