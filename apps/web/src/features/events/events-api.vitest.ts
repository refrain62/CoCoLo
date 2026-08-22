import { describe, expect, it, vi } from 'vitest';
import {
  createEventsApi,
  type EventSummary,
  EventsApiError,
} from './events-api.js';

const validEvent: EventSummary = {
  id: '00000000-0000-7000-8000-000000000101',
  title: '中央APIの予定',
  type: 'practice',
  startsAt: '2026-09-01T10:00:00.000Z',
  endsAt: '2026-09-01T12:00:00.000Z',
  location: null,
  itemsToBring: null,
  fee: 0,
  announcementImageAttachmentId: null,
  opponent: null,
  meetingTime: null,
  transportationRequired: false,
  attendanceDeadline: '2026-08-31T10:00:00.000Z',
  createdAt: '2026-08-22T00:00:00.000Z',
  updatedAt: '2026-08-22T00:00:00.000Z',
};

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
      new Response(JSON.stringify({ data: validEvent }), {
        status: 200,
      }),
    );
    const api = createEventsApi({ getAccessToken: () => 'token-a' });

    await expect(api.get(validEvent.id)).resolves.toEqual(validEvent);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/events/${validEvent.id}`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-a' }),
      }),
    );
    fetcher.mockRestore();
  });

  it('予定詳細の不正な応答を画面へ渡さない', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { id: validEvent.id } }), {
        status: 200,
      }),
    );
    const api = createEventsApi({ getAccessToken: () => 'token-a' });

    await expect(api.get(validEvent.id)).rejects.toEqual(
      new EventsApiError(
        502,
        'INVALID_RESPONSE',
        '予定詳細の応答形式が不正です。',
      ),
    );
    fetcher.mockRestore();
  });

  it('tokenがなければAPIへ送信しない', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const api = createEventsApi({ getAccessToken: () => null });

    await expect(api.summary(validEvent.id)).rejects.toEqual(
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
      api.answer(validEvent.id, {
        memberId: '00000000-0000-7000-8000-000000000201',
        response: 'absent',
      }),
    ).rejects.toEqual(
      new EventsApiError(409, 'ATTENDANCE_DEADLINE_PASSED', '締切後です。'),
    );
    fetcher.mockRestore();
  });

  it('不正な予定IDはURLへ渡さずUUIDv7として拒否する', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const api = createEventsApi({ getAccessToken: () => 'token-a' });

    await expect(api.get('event-a')).rejects.toEqual(
      new EventsApiError(400, 'VALIDATION_ERROR', '予定IDが不正です。'),
    );
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });

  it('現在回答を取得し、締切延長をPATCHへ渡す', async () => {
    const attendance = {
      eventId: validEvent.id,
      memberId: '00000000-0000-7000-8000-000000000201',
      response: 'attending' as const,
      updatedAt: validEvent.updatedAt,
    };
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        if (String(input).endsWith('/attendance'))
          return new Response(JSON.stringify({ data: [attendance] }), {
            status: 200,
          });
        return new Response(JSON.stringify({ data: validEvent }), {
          status: 200,
        });
      });
    const api = createEventsApi({ getAccessToken: () => 'token-a' });

    await expect(api.currentAttendance(validEvent.id)).resolves.toEqual([
      attendance,
    ]);
    await api.update(validEvent.id, {
      attendanceDeadline: '2026-09-01T09:00:00.000Z',
    });
    expect(fetcher).toHaveBeenLastCalledWith(
      `/api/v1/events/${validEvent.id}`,
      expect.objectContaining({ method: 'PATCH' }),
    );
    fetcher.mockRestore();
  });
});
