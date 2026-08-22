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
});
