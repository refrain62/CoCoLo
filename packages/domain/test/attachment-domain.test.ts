import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  AttachmentValidationError,
  detectAttachmentMediaType,
  validateAttachmentObject,
} from '../dist/attachment-domain.js';

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
]);

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('許可MIMEのmagic byteを判定する', () => {
  assert.equal(detectAttachmentMediaType(PNG), 'image/png');
  assert.equal(detectAttachmentMediaType(new Uint8Array([1, 2, 3])), null);
});

test('MIME、サイズ、magic byte、SHA-256が一致する実体だけを受理する', async () => {
  assert.deepEqual(
    await validateAttachmentObject({
      declaredMediaType: 'image/png',
      expectedByteSize: PNG.length,
      expectedSha256: sha256(PNG),
      object: { bytes: PNG, contentType: 'image/png' },
    }),
    { sha256: sha256(PNG), byteSize: PNG.length },
  );

  await assert.rejects(
    validateAttachmentObject({
      declaredMediaType: 'image/png',
      expectedByteSize: 3,
      expectedSha256: sha256(PNG),
      object: { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' },
    }),
    AttachmentValidationError,
  );
});
