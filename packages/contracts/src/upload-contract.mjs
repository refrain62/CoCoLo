import { z } from 'zod';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const UPLOAD_SESSION_TTL_SECONDS = 900;

const allowedMediaTypes = ['image/jpeg', 'image/png', 'application/pdf'];

export const uploadSessionInputSchema = z
  .object({
    mediaType: z.enum(allowedMediaTypes),
    byteSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    ownerUserId: z.string().min(1).max(128),
  })
  .strict();

export function parseUploadSessionInput(input) {
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
