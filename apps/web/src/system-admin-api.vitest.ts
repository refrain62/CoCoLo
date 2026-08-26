import { describe, expect, it, vi } from 'vitest';
import { createSystemAdminApi } from './system-admin-api.js';

const announcement = {
  id: '0198b5a8-0000-7000-8000-000000000001',
  title: 'メンテナンスのお知らせ',
  body: '停止時間のお知らせです。',
  status: 'published' as const,
  publishedAt: '2026-08-27T00:00:00.000Z',
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
};

describe('システム管理API client', () => {
  it('全体お知らせを取得し、チーム選択headerを送らない', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [announcement] }), { status: 200 }),
      );

    await expect(
      createSystemAdminApi({
        getAccessToken: () => 'system-token',
        fetcher,
      }).listAnnouncements(),
    ).resolves.toEqual([announcement]);
    expect(fetcher).toHaveBeenCalledWith('/api/v1/system/announcements', {
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer system-token',
      },
    });
  });

  it('お知らせの作成とfeatureの提供状態変更をJSONで送る', async () => {
    const feature = {
      key: 'orders-payments',
      billingType: 'paid' as const,
      displayName: '購買・集金',
      systemEnabled: false,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: announcement }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: feature }), { status: 200 }),
      );
    const api = createSystemAdminApi({
      getAccessToken: () => 'system-token',
      fetcher,
    });

    await api.createAnnouncement({
      title: announcement.title,
      body: announcement.body,
      status: announcement.status,
    });
    await api.updateFeature('orders-payments', {
      enabled: false,
      reason: '障害対応',
    });

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/v1/system/announcements', {
      method: 'POST',
      body: JSON.stringify({
        title: announcement.title,
        body: announcement.body,
        status: announcement.status,
      }),
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer system-token',
        'Content-Type': 'application/json',
      },
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/v1/system/features/orders-payments',
      {
        method: 'PATCH',
        body: JSON.stringify({ enabled: false, reason: '障害対応' }),
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer system-token',
          'Content-Type': 'application/json',
        },
      },
    );
  });

  it('未認証とAPIエラーを専用エラーへ変換する', async () => {
    await expect(
      createSystemAdminApi({ getAccessToken: () => null }).listFeatures(),
    ).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });

    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'FORBIDDEN', message: '権限がありません。' },
        }),
        { status: 403 },
      ),
    );
    await expect(
      createSystemAdminApi({
        getAccessToken: () => 'tenant-token',
        fetcher,
      }).listFeatures(),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });
});
