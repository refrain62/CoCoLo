import { z } from 'zod';

const uuidv7Schema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    '通知元IDはUUIDv7で指定してください。',
  );

// 通知本文と通知元をAPI境界で制限し、遷移先はサーバー側で生成する。
export const lineDeliveryPublishSchema = z
  .object({
    sourceType: z.enum(['event', 'deadline', 'bulletin']),
    sourceId: uuidv7Schema,
    destination: z.string().trim().min(1).max(128),
    title: z.string().trim().min(1).max(200),
    body: z.string().min(1).max(4000),
  })
  .strict();

export type LineDeliveryPublishInput = z.infer<
  typeof lineDeliveryPublishSchema
>;
