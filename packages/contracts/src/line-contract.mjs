import { z } from 'zod';

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

export const lineNotificationResponseSchema = z.object({
  id: z.string().uuid(),
  sourceType: lineNotificationSourceSchema,
  sourceId: z.string(),
  status: z.enum(['pending', 'sending', 'sent', 'failed']),
  attempts: z.number().int().nonnegative(),
  nextRetryAt: z.string().datetime().nullable(),
});

export function parseLineConnectInput(input) {
  return lineConnectInputSchema.parse(input);
}

export function parseLineNotificationInput(input) {
  return lineNotificationInputSchema.parse(input);
}

export function parseLineWebhookBody(input) {
  return lineWebhookBodySchema.parse(input);
}
