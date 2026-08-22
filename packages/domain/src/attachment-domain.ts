export type AttachmentMediaType =
  | 'image/jpeg'
  | 'image/png'
  | 'application/pdf';

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_SESSION_TTL_SECONDS = 900;

export type StoredAttachmentObject = {
  bytes: Uint8Array;
  contentType: string;
};

export class AttachmentValidationError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'AttachmentValidationError';
  }
}

export function detectAttachmentMediaType(
  bytes: Uint8Array,
): AttachmentMediaType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return 'image/png';
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return 'image/jpeg';
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  )
    return 'application/pdf';
  return null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new Uint8Array(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// ストレージから取得した実体だけを信頼し、MIME・サイズ・magic byte・SHA-256を独立に確認する。
export async function validateAttachmentObject(input: {
  declaredMediaType: AttachmentMediaType;
  expectedByteSize: number;
  expectedSha256: string;
  object: StoredAttachmentObject;
}): Promise<{ sha256: string; byteSize: number }> {
  if (input.object.contentType !== input.declaredMediaType)
    throw new AttachmentValidationError(
      '保存時MIMEが開始時のMIMEと一致しません。',
    );
  if (input.object.bytes.length !== input.expectedByteSize)
    throw new AttachmentValidationError(
      '実体サイズが開始時のサイズと一致しません。',
    );
  const detected = detectAttachmentMediaType(input.object.bytes);
  if (detected !== input.declaredMediaType)
    throw new AttachmentValidationError(
      'マジックバイトが許可MIMEと一致しません。',
    );
  const actualSha256 = await sha256Hex(input.object.bytes);
  if (actualSha256 !== input.expectedSha256)
    throw new AttachmentValidationError('SHA-256が申告値と一致しません。');
  return { sha256: actualSha256, byteSize: input.object.bytes.length };
}
