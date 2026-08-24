import { describe, expect, it, vi } from 'vitest';
import { createAttachmentApi } from './attachment-api.js';

describe('添付API client', () => {
  it('API呼び出しだけにAuthorizationを付け、ownerUserIdを送信しない', async () => {
    const fetcher = vi.fn(async (_input, init) => {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer token' });
      expect(JSON.parse(String(init?.body))).toEqual({
        mediaType: 'image/png',
        byteSize: 10,
      });
      return new Response(
        JSON.stringify({
          attachmentId: '01912345-6789-7abc-8def-0123456789ab',
          uploadUrl: 'https://fake-r2.local/upload/1',
          expiresAt: '2026-08-22T00:15:00.000Z',
          maxBytes: 20971520,
          mediaType: 'image/png',
        }),
        { status: 201 },
      );
    });
    const api = createAttachmentApi({
      getAccessToken: () => 'token',
      fetcher,
    });
    await expect(
      api.createUploadSession({ mediaType: 'image/png', byteSize: 10 }),
    ).resolves.toMatchObject({
      mediaType: 'image/png',
    });
  });

  it('選択中チームを添付APIへ明示する', async () => {
    let headers: HeadersInit | undefined;
    const fetcher = vi.fn(async (_input, init) => {
      headers = init?.headers;
      return new Response(
        JSON.stringify({
          attachmentId: '01912345-6789-7abc-8def-0123456789ab',
          uploadUrl: 'https://fake-r2.local/upload/1',
          expiresAt: '2026-08-22T00:15:00.000Z',
          maxBytes: 20971520,
          mediaType: 'image/png',
        }),
        { status: 201 },
      );
    });

    await createAttachmentApi({
      getAccessToken: () => 'token',
      getSelectedTeamId: () => '00000000-0000-7000-8000-000000000001',
      fetcher,
    }).createUploadSession({ mediaType: 'image/png', byteSize: 10 });

    expect(headers).toMatchObject({
      'X-CoCoLo-Team-Id': '00000000-0000-7000-8000-000000000001',
    });
  });
});
