import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGlobalAnnouncementsApi } from './global-announcements-api.js';

describe('global announcements api', () => {
  afterEach(() => vi.restoreAllMocks());

  it('選択中チームを付けて公開済み全体お知らせを取得する', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ id: 'notice-1', title: 'メンテナンス' }] }),
          { status: 200 },
        ),
      );
    const api = createGlobalAnnouncementsApi({
      getAccessToken: () => 'access-token',
      getSelectedTeamId: () => 'team-1',
      fetcher,
    });

    await expect(api.list()).resolves.toEqual([
      { id: 'notice-1', title: 'メンテナンス' },
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/global-announcements',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'X-CoCoLo-Team-Id': 'team-1',
        }),
      }),
    );
  });

  it('tokenがなければリクエストせず401相当のエラーにする', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const api = createGlobalAnnouncementsApi({
      getAccessToken: () => null,
      fetcher,
    });

    await expect(api.list()).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
