import { describe, expect, it, vi } from 'vitest';
import { createEventsApi, EventsApiError } from './events-api.js';

describe('createEventsApi', () => {
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

  it('予定詳細をBearer付きで取得する', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 'event-a' } }), {
        status: 200,
      }),
    );
    const api = createEventsApi({ getAccessToken: () => 'token-a' });

    await expect(api.get('event-a')).resolves.toEqual({ id: 'event-a' });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/events/event-a',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-a' }),
      }),
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
