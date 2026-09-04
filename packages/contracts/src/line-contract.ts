import { z } from 'zod';

export type LineNotificationSource = z.infer<
  typeof lineNotificationSourceSchema
>;
export type LineConnectInput = z.infer<typeof lineConnectInputSchema>;
export type LineNotificationInput = z.infer<typeof lineNotificationInputSchema>;
export type LineWebhookEvent = z.infer<typeof lineWebhookEventSchema>;
export type LineWebhookBody = z.infer<typeof lineWebhookBodySchema>;

export const lineNotificationSourceSchema = z.enum([
  'event',
  'deadline',
  'bulletin',
]);

// groupIdはLINEから受け取る外部識別子であり、tenantIdは認証コンテキストからだけ決める。
export const lineConnectInputSchema = z
  .object({
    groupId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^C[A-Za-z0-9_-]+$/, 'LINEのグループID形式が不正です。'),
  })
  .strict();

// 通知の発生元を限定し、イベント・締切・回覧以外のデータをLINEへ流さない。
export const lineNotificationInputSchema = z
  .object({
    sourceType: lineNotificationSourceSchema,
    sourceId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._~-]+$/, '通知元IDの形式が不正です。'),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(4000),
    deepLink: z.string().url().max(2048),
  })
  .strict();

export const lineWebhookEventSchema = z
  .object({
    type: z.string().min(1).max(64),
    timestamp: z.number().int().nonnegative(),
    source: z
      .object({
        type: z.enum(['group', 'room', 'user']),
        groupId: z.string().trim().min(1).max(128).optional(),
        userId: z.string().trim().min(1).max(128).optional(),
      })
      .strict(),
    webhookEventId: z.string().trim().min(1).max(128),
  })
  .strict();

export const lineWebhookBodySchema = z
  .object({
    destination: z.string().trim().min(1).max(128),
    events: z.array(lineWebhookEventSchema).max(100),
  })
  .strict();

const lineGroupIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^C[A-Za-z0-9_-]+$/);

export const lineNotificationResponseSchema = z
  .object({
    id: z.string().uuid(),
    sourceType: lineNotificationSourceSchema,
    sourceId: z.string(),
    status: z.enum(['pending', 'sending', 'sent', 'failed']),
    attempts: z.number().int().nonnegative(),
    nextRetryAt: z.string().datetime().nullable(),
  })
  .strict();

export const lineStatusResponseSchema = z
  .object({
    data: z
      .object({
        status: z.enum(['connected', 'disconnected']),
        groupId: lineGroupIdSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export const lineConnectResponseSchema = z
  .object({
    data: z
      .object({
        status: z.literal('connected'),
        groupId: lineGroupIdSchema,
      })
      .strict(),
  })
  .strict();

export const lineDisconnectResponseSchema = z
  .object({ data: z.object({ status: z.literal('disconnected') }).strict() })
  .strict();

export const lineNotificationEnvelopeResponseSchema = z
  .object({ data: lineNotificationResponseSchema })
  .strict();

export const lineEnqueueResponseSchema = z
  .object({
    data: z.union([
      z
        .object({
          status: z.literal('queued'),
          notification: lineNotificationResponseSchema,
        })
        .strict(),
      z
        .object({
          status: z.literal('not_connected'),
          notification: z.null(),
        })
        .strict(),
    ]),
  })
  .strict();

export const lineWebhookResponseSchema = z
  .object({
    data: z
      .object({
        accepted: z.number().int().nonnegative(),
        duplicates: z.number().int().nonnegative(),
        ignored: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export function parseLineConnectInput(input: unknown): LineConnectInput {
  return lineConnectInputSchema.parse(input);
}

export function parseLineNotificationInput(
  input: unknown,
): LineNotificationInput {
  return lineNotificationInputSchema.parse(input);
}

export function parseLineWebhookBody(input: unknown): LineWebhookBody {
  return lineWebhookBodySchema.parse(input);
}
