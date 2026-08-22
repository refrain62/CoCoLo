import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AuthSession } from './auth-client.js';
import { createAuthSessionManager } from './auth-context.js';
import {
  CentralNavigation,
  createCentralApis,
  createCentralIdentityApi,
  isUuidV7,
  matchCentralRoute,
  reconcileSelectedTeam,
  resolveCentralAuthState,
} from './central-navigation.js';

const tenantId = '018f0c80-7b00-7000-8000-000000000001';
const resourceId = '018f0c80-7b00-7000-8000-000000000002';
const otherTenantId = '018f0c80-7b00-7000-8000-000000000003';
const session: AuthSession = {
  accessToken: 'access-token',
  refreshToken: null,
  expiresAt: null,
};

describe('中央Webのroute境界', () => {
  it('認証前の直接URLは機能routeへ進めない', () => {
    expect(resolveCentralAuthState('/events', null)).toEqual({
      status: 'unauthenticated',
    });
  });

  it('未認証と所属API未接続を画面上で成功状態にしない', () => {
    const unauthenticated = renderToStaticMarkup(
      createElement(CentralNavigation, { session: null }),
    );
    expect(unauthenticated).toContain('ログインが必要です');

    const unavailable = renderToStaticMarkup(
      createElement(CentralNavigation, {
        identityState: {
          status: 'unavailable',
          message: '所属情報の中央APIが未接続です。',
        },
        session,
      }),
    );
    expect(unavailable).toContain('所属情報の中央APIが未接続です。');
    expect(unavailable).not.toContain('現在の権限');
  });

  it('認証済みの直接URLを既知routeへ解決する', () => {
    expect(resolveCentralAuthState('/events', session)).toEqual({
      status: 'authenticated',
      route: { kind: 'events' },
    });
    expect(matchCentralRoute('/manual')).toEqual({ kind: 'manual' });
    expect(matchCentralRoute('/bulletins')).toEqual({ kind: 'bulletins' });
    expect(matchCentralRoute('/team-selection')).toEqual({
      kind: 'team-selection',
    });
  });

  it('UUIDv7でない資源IDをAPIへ渡さない', () => {
    expect(isUuidV7(resourceId)).toBe(true);
    expect(matchCentralRoute('/ride/not-a-uuid')).toEqual({
      kind: 'invalid-resource',
      feature: 'ride',
    });
    expect(
      matchCentralRoute('/ride/018f0c80-7b00-6000-8000-000000000002'),
    ).toEqual({
      kind: 'invalid-resource',
      feature: 'ride',
    });
  });

  it('詳細画面が未接続の資源はIDを検証した上で未接続表示へ送る', () => {
    expect(matchCentralRoute(`/events/${resourceId}`)).toEqual({
      kind: 'resource-unavailable',
      feature: 'events',
      resourceId,
    });
  });

  it('unknown pathを機能画面として扱わない', () => {
    expect(matchCentralRoute('/does-not-exist')).toEqual({
      kind: 'unknown',
      pathname: '/does-not-exist',
    });
    expect(matchCentralRoute('/events/extra/path')).toEqual({
      kind: 'unknown',
      pathname: '/events/extra/path',
    });
  });
});

describe('中央所属API', () => {
  it('tenantをURLやbodyへ追加せずBearer tokenだけを送る', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const api = createCentralIdentityApi({
      getAccessToken: () => session.accessToken,
      fetcher: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(
          JSON.stringify({ data: { tenantId, role: 'staff' } }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      },
    });

    await expect(api.getCurrent()).resolves.toEqual({
      tenantId,
      role: 'staff',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('/api/v1/session');
    expect(requests[0]?.url).not.toContain('tenantId');
    expect(requests[0]?.init?.body).toBeUndefined();
    expect(requests[0]?.init?.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer access-token',
    });
  });

  it('中央APIの不正な所属応答を受け入れない', async () => {
    const api = createCentralIdentityApi({
      getAccessToken: () => session.accessToken,
      fetcher: async () =>
        new Response(
          JSON.stringify({ data: { tenantId: 'tenant-a', role: 'owner' } }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    });

    await expect(api.getCurrent()).rejects.toMatchObject({ status: 502 });
  });

  it('期限切れ401は中央のauthenticatedFetchでrefresh後に一度だけ再送する', async () => {
    const requests: RequestInit[] = [];
    let refreshCount = 0;
    const manager = createAuthSessionManager({
      storage: {
        getItem: (key) =>
          ({
            'cocolo.accessToken': 'old-access-token',
            'cocolo.refreshToken': 'refresh-token',
          })[key] ?? null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
      client: {
        signInWithPassword: async () => session,
        refreshSession: async () => {
          refreshCount += 1;
          return {
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
            expiresAt: null,
          };
        },
        signOut: async () => undefined,
      },
      requester: async (_input, init) => {
        requests.push(init ?? {});
        return new Response(JSON.stringify({ data: [] }), {
          status: requests.length === 1 ? 401 : 200,
        });
      },
    });
    const apis = createCentralApis(
      'old-access-token',
      manager.authenticatedFetch,
      tenantId,
    );

    await expect(apis.events.list('2026-01-01', '2026-01-02')).resolves.toEqual(
      [],
    );
    expect(refreshCount).toBe(1);
    expect(requests).toHaveLength(2);
    expect(new Headers(requests[1]?.headers).get('Authorization')).toBe(
      'Bearer new-access-token',
    );
    expect(new Headers(requests[1]?.headers).get('X-CoCoLo-Team-Id')).toBe(
      tenantId,
    );
  });

  it('再読み込み候補はBearerで再取得した所属一覧にないtenantを復元しない', () => {
    const teams = [{ tenantId, tenantName: 'Aチーム', role: 'owner' as const }];
    expect(reconcileSelectedTeam(teams, otherTenantId)).toBeNull();
    expect(reconcileSelectedTeam(teams, tenantId)).toEqual(teams[0]);
  });
});
