import { z } from 'zod';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const UPLOAD_SESSION_TTL_SECONDS = 900;

// 許可MIMEとサイズ上限を契約の単一定義にし、署名URL発行側と完了検証側で共有する。
const allowedMediaTypes = [
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const;

export type AttachmentMediaType = (typeof allowedMediaTypes)[number];
export type UploadSessionRequest = {
  mediaType: AttachmentMediaType;
  byteSize: number;
};
export type UploadCompleteInput = {
  sha256: string;
  byteSize: number;
};

export const uploadSessionRequestSchema = z
  .object({
    mediaType: z.enum(allowedMediaTypes),
    byteSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  })
  .strict();

// 外部入力をupload session契約へ変換し、呼び出し側が未検証値を扱わないようにする。
export function parseUploadSessionInput(
  input: unknown,
): UploadSessionRequest {
  return uploadSessionInputSchema.parse(input);
}

// 後方互換の名前は残すが、所有者は認証コンテキストから決めるため入力へ含めない。
export const uploadSessionInputSchema = uploadSessionRequestSchema;

export const uploadSessionResponseSchema = z
  .object({
    attachmentId: z.string().uuid(),
    uploadUrl: z.string().url(),
    expiresAt: z.string().datetime(),
    maxBytes: z.literal(MAX_UPLOAD_BYTES),
    mediaType: z.enum(allowedMediaTypes),
  })
  .strict();

export const uploadCompleteInputSchema = z
  .object({
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    byteSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  })
  .strict();

export const uploadIdSchema = z.string().uuid();

export const attachmentResponseSchema = z
  .object({
    attachmentId: z.string().uuid(),
    status: z.enum(['available']),
    mediaType: z.enum(allowedMediaTypes),
    byteSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export const downloadResponseSchema = z
  .object({
    attachmentId: z.string().uuid(),
    downloadUrl: z.string().url(),
    expiresAt: z.string().datetime(),
  })
  .strict();
