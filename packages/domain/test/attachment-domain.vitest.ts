import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createAttachmentId,
  detectAttachmentMediaType,
  validateAttachmentObject,
} from '../src/attachment-domain.js';

const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
]);

describe('添付ドメイン', () => {
  it('許可MIMEのmagic bytesを判定する', () => {
    expect(detectAttachmentMediaType(png)).toBe('image/png');
    expect(detectAttachmentMediaType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(
      'image/jpeg',
    );
    expect(
      detectAttachmentMediaType(new TextEncoder().encode('%PDF-1.7')),
    ).toBe('application/pdf');
    expect(detectAttachmentMediaType(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('MIME、サイズ、magic bytes、SHA-256を同時に検証する', async () => {
    const sha256 = createHash('sha256').update(png).digest('hex');
    await expect(
      validateAttachmentObject({
        declaredMediaType: 'image/png',
        expectedByteSize: png.length,
        expectedSha256: sha256,
        object: { bytes: png, contentType: 'image/png' },
      }),
    ).resolves.toEqual({ sha256, byteSize: png.length });
    await expect(
      validateAttachmentObject({
        declaredMediaType: 'image/png',
        expectedByteSize: png.length,
        expectedSha256: '0'.repeat(64),
        object: { bytes: png, contentType: 'image/png' },
      }),
    ).rejects.toThrow('SHA-256');
  });

  it('資源IDはUUIDv7のversionとvariantを持つ', () => {
    const id = createAttachmentId(0x019123456789);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
