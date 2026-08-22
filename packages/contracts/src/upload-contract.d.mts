import type { z } from 'zod';

export type AttachmentMediaType =
  | 'image/jpeg'
  | 'image/png'
  | 'application/pdf';
export type UploadSessionRequest = {
  mediaType: AttachmentMediaType;
  byteSize: number;
};
export type UploadCompleteInput = {
  sha256: string;
  byteSize: number;
};

export declare const MAX_UPLOAD_BYTES: 20971520;
export declare const UPLOAD_SESSION_TTL_SECONDS: 900;
export declare const allowedMediaTypes: readonly AttachmentMediaType[];
export declare const uploadSessionRequestSchema: z.ZodType<UploadSessionRequest>;
export declare const uploadSessionInputSchema: z.ZodType<UploadSessionRequest>;
export declare function parseUploadSessionInput(
  input: unknown,
): UploadSessionRequest;
export declare const uploadSessionResponseSchema: z.ZodType<{
  attachmentId: string;
  uploadUrl: string;
  expiresAt: string;
  maxBytes: 20971520;
  mediaType: AttachmentMediaType;
}>;
export declare const uploadCompleteInputSchema: z.ZodType<UploadCompleteInput>;
export declare const uploadIdSchema: z.ZodType<string>;
export declare const attachmentResponseSchema: z.ZodType<{
  attachmentId: string;
  status: 'available';
  mediaType: AttachmentMediaType;
  byteSize: number;
  sha256: string;
}>;
export declare const downloadResponseSchema: z.ZodType<{
  attachmentId: string;
  downloadUrl: string;
  expiresAt: string;
}>;
