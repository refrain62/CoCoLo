export type AttachmentMediaType =
  | 'image/jpeg'
  | 'image/png'
  | 'application/pdf';

export type AttachmentStatus =
  | 'uploaded'
  | 'available'
  | 'rejected'
  | 'deleted';

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_SESSION_TTL_SECONDS = 900;
export const ATTACHMENT_COMPLETE_MAX_ATTEMPTS = 3;

export type AttachmentRecord = {
  id: string;
  tenantId: string;
  ownerUserId: string;
  objectKey: string;
  mediaType: AttachmentMediaType;
  byteSize: number;
  sha256: string | null;
  status: AttachmentStatus;
  expiresAt: Date;
  completeAttempts: number;
  cleanupAttempts: number;
  cleanupCompletedAt: Date | null;
  createdAt: Date;
  availableAt: Date | null;
  deletedAt: Date | null;
};

export type CreateAttachmentSessionInput = {
  id: string;
  tenantId: string;
  ownerUserId: string;
  role: 'owner' | 'admin' | 'staff' | 'guardian';
  objectKey: string;
  mediaType: AttachmentMediaType;
  byteSize: number;
  expiresAt: Date;
  now: Date;
};

export type CompleteAttachmentInput = {
  id: string;
  tenantId: string;
  ownerUserId: string;
  role: 'owner' | 'admin' | 'staff' | 'guardian';
  now: Date;
};

export type AttachmentVerification =
  | { kind: 'available'; sha256: string; byteSize: number }
  | { kind: 'rejected'; reason: string }
  | { kind: 'retryable'; reason: string };

export type CompleteAttachmentOutcome = {
  state: 'available' | 'rejected' | 'retryable';
  record: AttachmentRecord;
  reason: string | null;
  cleanupRequired: boolean;
};

export type AttachmentCleanupInput = {
  id: string;
  tenantId: string;
  ownerUserId: string;
  role: 'owner' | 'admin' | 'staff' | 'guardian';
};

export type ExpiredAttachmentCleanupInput = {
  tenantId: string;
  actorUserId: string;
  role: 'owner' | 'admin' | 'staff' | 'guardian';
  now: Date;
  limit: number;
};

export type AttachmentRepository = {
  createSession: (
    input: CreateAttachmentSessionInput,
  ) => Promise<AttachmentRecord>;
  complete: (
    input: CompleteAttachmentInput,
    verify: (record: AttachmentRecord) => Promise<AttachmentVerification>,
  ) => Promise<CompleteAttachmentOutcome>;
  findAvailable: (
    input: AttachmentCleanupInput,
  ) => Promise<AttachmentRecord | null>;
  findRejectedForCleanup: (
    input: AttachmentCleanupInput,
  ) => Promise<AttachmentRecord | null>;
  listExpiredUploaded: (
    input: ExpiredAttachmentCleanupInput,
  ) => Promise<AttachmentRecord[]>;
  rejectExpired: (input: {
    id: string;
    tenantId: string;
    actorUserId: string;
    role: 'owner' | 'admin' | 'staff' | 'guardian';
    now: Date;
  }) => Promise<AttachmentRecord | null>;
  recordCleanupAttempt: (input: {
    id: string;
    tenantId: string;
    ownerUserId: string;
    role: 'owner' | 'admin' | 'staff' | 'guardian';
    completed: boolean;
  }) => Promise<void>;
};

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

// 署名URLを持つだけでは信頼せず、ストレージから取得した実体を三つの独立条件で検証する。
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

// オブジェクトキーに個人情報を含めず、時系列を持つUUIDv7を境界IDとして発行する。
export function createAttachmentId(now = Date.now()): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number((timestamp >> BigInt((5 - index) * 8)) & 0xffn);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
