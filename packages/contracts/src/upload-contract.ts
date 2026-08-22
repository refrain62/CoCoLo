import { z } from 'zod';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const UPLOAD_SESSION_TTL_SECONDS = 900;

// 許可MIMEとサイズ上限を契約の単一定義にし、署名URL発行側と完了検証側で共有する。
const allowedMediaTypes = [
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const;

export const uploadSessionInputSchema = z
  .object({
    mediaType: z.enum(allowedMediaTypes),
    byteSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    ownerUserId: z.string().min(1).max(128),
  })
  .strict();

// 外部入力をupload session契約へ変換し、呼び出し側が未検証値を扱わないようにする。
export function parseUploadSessionInput(input: unknown) {
  return uploadSessionInputSchema.parse(input);
}

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
