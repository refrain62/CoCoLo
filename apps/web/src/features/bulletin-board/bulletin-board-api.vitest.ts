import { afterEach, describe, expect, it } from 'vitest';
import { createBulletinBoardApi } from './bulletin-board-api.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('回覧板APIクライアント', () => {
  it('一覧取得にBearerとページ条件を付ける', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = async (input, init) => {
      request = { url: String(input), init };
      return new Response(
        JSON.stringify({ data: [], page: 2, pageSize: 10, hasNext: false }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    await createBulletinBoardApi({ getAccessToken: () => 'token' }).list(2, 10);

    expect(request?.url).toBe('/api/v1/announcements?page=2&pageSize=10');
    expect(request?.init?.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer token',
    });
  });

  it('掲載本文と添付IDをJSONで送信し、公開URLを生成しない', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = async (input, init) => {
      request = { url: String(input), init };
      return new Response(
        JSON.stringify({
          data: {
            id: '00000000-0000-7000-8000-000000001001',
            title: '資料',
            body: '本文',
            status: 'published',
            publishedAt: '2026-08-22T00:00:00.000Z',
            attachmentCount: 1,
            readAt: null,
            isRead: false,
            isAuthor: true,
            canViewUnread: true,
            attachments: [
              {
                id: '00000000-0000-7000-8000-000000002001',
                mediaType: 'application/pdf',
                byteSize: 10,
              },
            ],
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    };

    await createBulletinBoardApi({ getAccessToken: () => 'token' }).publish({
      title: '資料',
      body: '本文',
      attachmentIds: ['00000000-0000-7000-8000-000000002001'],
    });

    expect(request?.url).toBe('/api/v1/announcements');
    expect(request?.init?.body).toBe(
      JSON.stringify({
        title: '資料',
        body: '本文',
        attachmentIds: ['00000000-0000-7000-8000-000000002001'],
      }),
    );
    expect(String(request?.init?.body)).not.toContain('downloadUrl');
  });

  it('既読操作と未読者一覧のパスを分離する', async () => {
    const paths: string[] = [];
    globalThis.fetch = async (input) => {
      paths.push(String(input));
      if (String(input).endsWith('/read'))
        return new Response(
          JSON.stringify({ data: { readAt: '2026-08-22T00:00:00.000Z' } }),
          { status: 200 },
        );
      return new Response(JSON.stringify({ data: [], unreadCount: 0 }), {
        status: 200,
      });
    };
    const api = createBulletinBoardApi({ getAccessToken: () => 'token' });
    await api.markRead('00000000-0000-7000-8000-000000001001');
    await api.listUnread('00000000-0000-7000-8000-000000001001');
    expect(paths).toEqual([
      '/api/v1/announcements/00000000-0000-7000-8000-000000001001/read',
      '/api/v1/announcements/00000000-0000-7000-8000-000000001001/unread',
    ]);
  });
});
