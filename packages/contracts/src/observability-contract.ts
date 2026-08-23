import { z } from 'zod';

function hasUnsafeControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

const safeLogString = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !hasUnsafeControlCharacter(value));

// ログ項目を固定し、認証情報、本文、クエリ、個人情報を型として受け付けない。
export const structuredLogEntrySchema = z
  .object({
    timestamp: z.string().datetime({ offset: true }),
    level: z.enum(['info', 'warn', 'error']),
    event: z.enum([
      'request.completed',
      'security.denied',
      'dependency.failure',
    ]),
    service: z.literal('api'),
    environment: z.enum(['local', 'staging', 'production']),
    requestId: safeLogString,
    method: z.enum([
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
      'HEAD',
    ]),
    path: z
      .string()
      .min(1)
      .max(512)
      .refine(
        (value) =>
          value.startsWith('/') &&
          !value.includes('?') &&
          !hasUnsafeControlCharacter(value),
      ),
    status: z.number().int().min(100).max(599),
    durationMs: z.number().finite().min(0).max(600_000),
    errorCode: safeLogString.optional(),
  })
  .strict();

export type StructuredLogEntry = z.infer<typeof structuredLogEntrySchema>;
