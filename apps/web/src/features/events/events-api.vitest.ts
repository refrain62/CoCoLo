import { describe, expect, it, vi } from 'vitest';
import { createEventsApi, EventsApiError } from './events-api.js';

describe('createEventsApi', () => {
  it('注入した認証済みfetcherを利用する', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );
    const api = createEventsApi({
      getAccessToken: () => 'token-a',
      fetcher,
    });

    await api.list('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z');

    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('Bearerと期間を予定一覧へ渡す', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );
    const api = createEventsApi({ getAccessToken: () => 'token-a' });

    await api.list('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z');

    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/events?from=2026-08-01T00%3A00%3A00Z&to=2026-09-01T00%3A00%3A00Z',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-a' }),
      }),
    );
    fetcher.mockRestore();
  });

  it('予定詳細と現在の出欠を取得する', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                eventId: 'event-a',
                memberId: 'member-a',
                response: 'attending',
                updatedAt: '2026-08-24T00:00:00Z',
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const api = createEventsApi({ getAccessToken: () => 'token-a' });

    await api.get('event-a');
    await api.currentAttendance('event-a');

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/api/v1/events/event-a',
      expect.anything(),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/v1/events/event-a/attendance',
      expect.anything(),
    );
    fetcher.mockRestore();
  });

  it('tokenがなければAPIへ送信しない', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const api = createEventsApi({ getAccessToken: () => null });

    await expect(api.summary('event-a')).rejects.toEqual(
      new EventsApiError(401, 'UNAUTHENTICATED', 'ログインが必要です。'),
    );
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });

  it('選択中チームを予定APIへ明示する', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );
    const api = createEventsApi({
      getAccessToken: () => 'token-a',
      getSelectedTeamId: () => '00000000-0000-7000-8000-000000000001',
    });

    await api.list('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z');

    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      'X-CoCoLo-Team-Id': '00000000-0000-7000-8000-000000000001',
    });
    fetcher.mockRestore();
  });

  it('締切後エラーをAPIエラーとして保持する', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'ATTENDANCE_DEADLINE_PASSED',
            message: '締切後です。',
          },
        }),
        { status: 409 },
      ),
    );
    const api = createEventsApi({ getAccessToken: () => 'token-a' });

    await expect(
      api.answer('event-a', { memberId: 'member-a', response: 'absent' }),
    ).rejects.toEqual(
      new EventsApiError(409, 'ATTENDANCE_DEADLINE_PASSED', '締切後です。'),
    );
    fetcher.mockRestore();
  });
});
