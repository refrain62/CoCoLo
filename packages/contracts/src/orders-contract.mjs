import { z } from 'zod';

const uuid = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });

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

export const orderProductPathSchema = z.object({ orderId: uuid }).strict();

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
            selectedOptions: z.record(z.string().trim().min(1).max(100), z.string().trim().min(1).max(100)).default({}),
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

export function parseOrderCreate(input) {
  return orderCreateSchema.parse(input);
}

export function parseOrderEntryCreate(input) {
  return orderEntryCreateSchema.parse(input);
}

export function parseOrderStatusUpdate(input) {
  return orderStatusUpdateSchema.parse(input);
}

export function parsePaymentUpdate(input) {
  return paymentUpdateSchema.parse(input);
}
