import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUploadSessionInput } from '../src/upload-contract.ts';

test('アップロードセッションは許可 MIME・20 MiB 以下・所有者の範囲を受け付ける', () => {
  const parsed = parseUploadSessionInput({
    mediaType: 'image/jpeg',
    byteSize: 20 * 1024 * 1024,
    ownerUserId: 'user-1',
  });

  assert.deepEqual(parsed, {
    mediaType: 'image/jpeg',
    byteSize: 20 * 1024 * 1024,
    ownerUserId: 'user-1',
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
