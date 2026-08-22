import { z } from 'zod';

// 通知本文と遷移先をAPI境界で制限し、DBのoutbox制約と同じ値域へ正規化する。
export const lineDeliveryPublishSchema = z
  .object({
    sourceId: z.string().trim().min(1).max(128),
    destination: z.string().trim().min(1).max(128),
    title: z.string().trim().min(1).max(200),
    body: z.string().min(1).max(4000),
    deepLink: z
      .string()
      .trim()
      .min(1)
      .max(2048)
      .refine(
        (value) => /^https:\/\/|^http:\/\/localhost(:[0-9]+)?\//.test(value),
        'httpsまたはlocalhostの遷移先を指定してください。',
      ),
  })
  .strict();

export type LineDeliveryPublishInput = z.infer<
  typeof lineDeliveryPublishSchema
>;
