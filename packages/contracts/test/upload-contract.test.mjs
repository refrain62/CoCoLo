import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUploadSessionInput } from '../src/upload-contract.mjs';

test('upload sessionは許可MIME・20MiB以下・owner scopeを受け付ける', () => {
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

test('upload sessionはSVG、0 byte、20MiB超過を拒否する', () => {
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
