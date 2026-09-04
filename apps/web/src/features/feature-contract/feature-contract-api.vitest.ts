import { describe, expect, it, vi } from 'vitest';
import { createFeatureContractApi } from './feature-contract-api.js';

const snapshot = {
  data: {
    planKey: 'standard',
    planStatus: 'active',
    features: [
      {
        key: 'members',
        billingType: 'free',
        displayName: 'メンバー管理',
        enabled: true,
        reason: 'default',
      },
    ],
  },
};

describe('機能契約API client', () => {
  it('選択中チームの契約を取得する', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(snapshot), { status: 200 }),
      );

    await expect(
      createFeatureContractApi({
        getAccessToken: () => 'access-token',
        getSelectedTeamId: () => 'team-id',
        fetcher,
      }).get(),
    ).resolves.toEqual(snapshot.data);
    expect(fetcher).toHaveBeenCalledWith('/api/v1/feature-contract', {
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer access-token',
        'X-CoCoLo-Team-Id': 'team-id',
      },
    });
  });

  it('無償feature flagの更新理由を送信する', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(snapshot), { status: 200 }),
      );

    await createFeatureContractApi({
      getAccessToken: () => 'access-token',
      fetcher,
    }).updateFreeFlag({
      featureKey: 'members',
      enabled: false,
      reason: '運用停止',
    });

    expect(fetcher).toHaveBeenCalledWith('/api/v1/feature-contract/members', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false, reason: '運用停止' }),
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer access-token',
        'Content-Type': 'application/json',
      },
    });
  });

  it('不正な契約レスポンスを成功として扱わない', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { features: 'invalid' } }), {
        status: 200,
      }),
    );

    await expect(
      createFeatureContractApi({
        getAccessToken: () => 'access-token',
        fetcher,
      }).get(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 502 });
  });

  it('同時の契約取得を一つの要求へ集約し、完了後は再取得できる', async () => {
    let resolveResponse!: (response: Response) => void;
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(responsePromise)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(snapshot), { status: 200 }),
      );
    const api = createFeatureContractApi({
      getAccessToken: () => 'access-token',
      fetcher,
    });

    const first = api.get();
    const second = api.get();
    expect(second).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolveResponse(new Response(JSON.stringify(snapshot), { status: 200 }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      snapshot.data,
      snapshot.data,
    ]);

    await api.get();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
