import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseUploadSessionInput,
  uploadCleanupResponseSchema,
  uploadCompleteResponseSchema,
  uploadDownloadResponseSchema,
  uploadExpiredCleanupResponseSchema,
} from '../src/upload-contract.ts';

test('アップロードセッションは許可 MIMEと20 MiB以下を受け付ける', () => {
  const parsed = parseUploadSessionInput({
    mediaType: 'image/jpeg',
    byteSize: 20 * 1024 * 1024,
  });

  assert.deepEqual(parsed, {
    mediaType: 'image/jpeg',
    byteSize: 20 * 1024 * 1024,
  });
});

test('アップロードセッションは SVG、0 バイト、20 MiB 超過を拒否する', () => {
  for (const input of [
    { mediaType: 'image/svg+xml', byteSize: 1, ownerUserId: 'user-1' },
    { mediaType: 'image/png', byteSize: 0, ownerUserId: 'user-1' },
    {
      mediaType: 'image/png',
      byteSize: 20 * 1024 * 1024 + 1,
      ownerUserId: 'user-1',
    },
  ]) {
    assert.throws(() => parseUploadSessionInput(input));
  }
});

test('添付の完了・download・cleanup responseは内部情報を公開しない', () => {
  const attachmentId = '00000000-0000-4000-8000-000000000101';
  assert.equal(
    uploadCompleteResponseSchema.safeParse({
      data: {
        attachmentId,
        status: 'available',
        mediaType: 'image/png',
        byteSize: 4,
        sha256: 'a'.repeat(64),
      },
    }).success,
    true,
  );
  assert.equal(
    uploadCompleteResponseSchema.safeParse({
      data: {
        attachmentId,
        status: 'available',
        mediaType: 'image/png',
        byteSize: 4,
        sha256: 'a'.repeat(64),
        tenantId: 'tenant-a',
      },
    }).success,
    false,
  );
  assert.equal(
    uploadDownloadResponseSchema.safeParse({
      data: {
        attachmentId,
        downloadUrl: 'https://storage.example.test/download',
        expiresAt: '2026-08-24T00:00:00.000Z',
      },
    }).success,
    true,
  );
  assert.equal(
    uploadExpiredCleanupResponseSchema.safeParse({
      data: { scannedCount: 2, cleanedCount: 1, pendingCount: 1 },
    }).success,
    true,
  );
  assert.equal(
    uploadCleanupResponseSchema.safeParse({
      data: { attachmentId, cleaned: true },
    }).success,
    true,
  );
});
