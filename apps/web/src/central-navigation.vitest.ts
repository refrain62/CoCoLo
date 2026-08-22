import { describe, expect, it } from 'vitest';
import type { AuthSession } from './auth-client.js';
import {
  createCentralIdentityApi,
  isUuidV7,
  matchCentralRoute,
  resolveCentralAuthState,
} from './central-navigation.js';

const tenantId = '018f0c80-7b00-7000-8000-000000000001';
const resourceId = '018f0c80-7b00-7000-8000-000000000002';
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

  it('認証済みの直接URLを既知routeへ解決する', () => {
    expect(resolveCentralAuthState('/events', session)).toEqual({
      status: 'authenticated',
      route: { kind: 'events' },
    });
    expect(matchCentralRoute('/manual')).toEqual({ kind: 'manual' });
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
});
