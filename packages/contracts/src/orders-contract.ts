import { z } from 'zod';

const uuid = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });

// 注文資源はDBの主キー生成器と同じUUIDv7だけを受け付け、旧形式や任意文字列を永続層へ渡さない。
const uuidv7Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const uuidv7ResourceIdSchema = z.string().regex(uuidv7Pattern);

export function parseUuidv7ResourceId(input: unknown): string {
  return uuidv7ResourceIdSchema.parse(input);
}

export const orderOptionSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    values: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  })
  .strict();

export const orderProductSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    unitPrice: z.number().int().min(0).max(1_000_000_000),
    imageUrl: z.string().url().max(2000).nullable().optional(),
    options: z.array(orderOptionSchema).max(20).default([]),
    requiresBackNumber: z.boolean().default(false),
    requiresBackName: z.boolean().default(false),
  })
  .strict();

export const orderCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    deadline: dateTime,
    products: z.array(orderProductSchema).min(1).max(100),
  })
  .strict();

export const orderProductPathSchema = z
  .object({ orderId: uuidv7ResourceIdSchema })
  .strict();

export const orderEntryCreateSchema = z
  .object({
    memberId: uuid,
    ordererName: z.string().trim().min(1).max(200),
    lines: z
      .array(
        z
          .object({
            productId: uuid,
            quantity: z.number().int().min(1).max(10_000),
            selectedOptions: z
              .record(
                z.string().trim().min(1).max(100),
                z.string().trim().min(1).max(100),
              )
              .default({}),
            backNumber: z.string().trim().max(20).nullable().optional(),
            backName: z.string().trim().max(40).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const orderStatusUpdateSchema = z
  .object({ status: z.enum(['closed', 'completed']) })
  .strict();

export const paymentUpdateSchema = z
  .object({ status: z.enum(['unpaid', 'paid']) })
  .strict();

export const orderListQuerySchema = z
  .object({ status: z.enum(['open', 'closed', 'completed']).optional() })
  .strict();

export const paymentStatusQuerySchema = z
  .object({ paymentStatus: z.enum(['unpaid', 'paid']).optional() })
  .strict();

export type OrderCreateInput = z.infer<typeof orderCreateSchema>;
export type OrderEntryCreateInput = z.infer<typeof orderEntryCreateSchema>;
export type OrderStatusUpdateInput = z.infer<typeof orderStatusUpdateSchema>;
export type PaymentUpdateInput = z.infer<typeof paymentUpdateSchema>;

export function parseOrderCreate(input: unknown) {
  return orderCreateSchema.parse(input);
}

export function parseOrderEntryCreate(input: unknown) {
  return orderEntryCreateSchema.parse(input);
}

export function parseOrderStatusUpdate(input: unknown) {
  return orderStatusUpdateSchema.parse(input);
}

export function parsePaymentUpdate(input: unknown) {
  return paymentUpdateSchema.parse(input);
}
