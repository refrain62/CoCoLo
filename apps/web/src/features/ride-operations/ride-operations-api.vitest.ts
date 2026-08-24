import { describe, expect, it, vi } from 'vitest';
import {
  createRideOperationsApi,
  RideApiError,
} from './ride-operations-api.js';

describe('送迎Web API', () => {
  it('中央画面から注入された認証済みfetcherを利用する', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await createRideOperationsApi({
      getAccessToken: () => 'token',
      fetcher,
    }).listPlans();

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/ride-plans',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );
  });

  it('送迎予定一覧を取得する', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ data: [{ id: 'plan-1', title: '練習試合' }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
    );

    const plans = await createRideOperationsApi({
      getAccessToken: () => 'token',
    }).listPlans();

    expect(plans).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/ride-plans',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );
  });

  it('access tokenなしでは送信せずログインエラーにする', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const api = createRideOperationsApi({ getAccessToken: () => null });
    await expect(api.getSnapshot('plan-1')).rejects.toEqual(
      new RideApiError(401, 'UNAUTHENTICATED', 'ログインが必要です。'),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('planIdをURL encodeし、BearerとJSONを付けて送る', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              plan: { id: 'plan/a' },
              offers: [],
              requests: [],
              assignments: [],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const api = createRideOperationsApi({
      baseUrl: 'https://api.example.test',
      getAccessToken: () => 'token',
    });
    await api.getSnapshot('plan/a');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/ride-plans/plan%2Fa',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );
  });

  it('選択中のtenantを中央APIのheaderへ付ける', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              plan: { id: 'plan-1' },
              offers: [],
              requests: [],
              assignments: [],
              history: [],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const api = createRideOperationsApi({
      getAccessToken: () => 'token',
      getSelectedTeamId: () => 'team-1',
    });
    await api.getSnapshot('plan-1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/ride-plans/plan-1',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-CoCoLo-Team-Id': 'team-1' }),
      }),
    );
  });

  it('APIエラーのcodeとmessageを保持する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'RIDE_CAPACITY_EXCEEDED', message: '定員超過' },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const api = createRideOperationsApi({ getAccessToken: () => 'token' });
    await expect(api.getSnapshot('plan-1')).rejects.toEqual(
      new RideApiError(409, 'RIDE_CAPACITY_EXCEEDED', '定員超過'),
    );
  });
});
