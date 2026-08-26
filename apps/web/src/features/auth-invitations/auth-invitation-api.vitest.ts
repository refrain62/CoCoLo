import { describe, expect, it } from 'vitest';
import { createAuthInvitationApi } from './auth-invitation-api.js';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('auth invitation API', () => {
  it('管理者向けの招待発行へ選択中チームを付与する', async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const api = createAuthInvitationApi({
      getSelectedTeamId: () => '018f5b2d-8b5f-7c4a-8f10-123456789abc',
      fetcher: async (input, init) => {
        request = { url: String(input), init: init ?? {} };
        return response({
          data: {
            id: '018f5b2d-8b5f-7c4a-8f10-123456789abe',
            memberId: '018f5b2d-8b5f-7c4a-8f10-123456789abd',
            role: 'guardian',
            linkType: 'guardian',
            relationship: '保護者',
            inviteUrl: 'https://app.example.com/invite/opaque',
            expiresAt: '2026-08-25T12:00:00.000Z',
          },
        });
      },
    });

    await expect(
      api.create({
        memberId: '018f5b2d-8b5f-7c4a-8f10-123456789abd',
        role: 'guardian',
        linkType: 'guardian',
        relationship: '保護者',
        expiresInHours: 72,
      }),
    ).resolves.toMatchObject({ role: 'guardian' });
    expect(request?.url).toBe('/api/v1/auth/invitations');
    expect(request?.init.headers).toMatchObject({
      'X-CoCoLo-Team-Id': '018f5b2d-8b5f-7c4a-8f10-123456789abc',
    });
  });

  it('providerを含む受諾要求を認証済みfetchへ渡す', async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const api = createAuthInvitationApi({
      fetcher: async (input, init) => {
        request = { url: String(input), init: init ?? {} };
        return response({
          data: {
            tenantId: '018f5b2d-8b5f-7c4a-8f10-123456789abc',
            memberId: '018f5b2d-8b5f-7c4a-8f10-123456789abd',
            role: 'guardian',
            linkType: 'guardian',
            linkStatus: 'active',
          },
        });
      },
    });

    await expect(
      api.accept({
        token: 'a'.repeat(32),
        provider: 'google',
      }),
    ).resolves.toMatchObject({ role: 'guardian', linkStatus: 'active' });
    expect(request?.url).toBe('/api/v1/auth/invitations/accept');
    expect(JSON.parse(String(request?.init.body))).toEqual({
      token: 'a'.repeat(32),
      provider: 'google',
    });
  });

  it('APIエラーは固定されたAuthInvitationApiErrorへ変換する', async () => {
    const api = createAuthInvitationApi({
      fetcher: async () =>
        response(
          {
            error: {
              code: 'OAUTH_PROVIDER_UNVERIFIED',
              message: '再ログインが必要です。',
            },
          },
          403,
        ),
    });

    await expect(
      api.accept({ token: 'a'.repeat(32), provider: 'line' }),
    ).rejects.toEqual(
      expect.objectContaining({
        status: 403,
        code: 'OAUTH_PROVIDER_UNVERIFIED',
        message: '再ログインが必要です。',
      }),
    );
  });
});
