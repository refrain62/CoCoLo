import { z } from 'zod';

const uuid = z.string().uuid();
const uuidv7 = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
const dateTime = z.string().datetime({ offset: true });
const money = z.number().int().min(0);

const orderOptionResponseSchema = z
  .object({
    name: z.string().min(1).max(100),
    values: z.array(z.string().min(1).max(100)).min(1).max(100),
  })
  .strict();

const orderProductResponseSchema = z
  .object({
    id: uuidv7,
    name: z.string().min(1).max(200),
    unitPrice: money.max(1_000_000_000),
    imageUrl: z.string().url().max(2000).nullable(),
    options: z.array(orderOptionResponseSchema).max(20),
    requiresBackNumber: z.boolean(),
    requiresBackName: z.boolean(),
  })
  .strict();

const orderProductWithCampaignResponseSchema = z
  .object({ campaignId: uuidv7, ...orderProductResponseSchema.shape })
  .strict();

const orderCampaignResponseSchema = z
  .object({
    id: uuidv7,
    title: z.string().min(1).max(200),
    deadline: dateTime,
    status: z.enum(['open', 'closed', 'completed']),
    products: z.array(orderProductResponseSchema).max(100),
    createdAt: dateTime,
  })
  .strict();

const orderLineResponseSchema = z
  .object({
    id: uuidv7,
    productId: uuidv7,
    productName: z.string().min(1).max(200),
    unitPrice: money.max(1_000_000_000),
    quantity: z.number().int().min(1).max(10_000),
    selectedOptions: z.record(
      z.string().min(1).max(100),
      z.string().min(1).max(100),
    ),
    backNumber: z.string().max(20).nullable(),
    backName: z.string().max(40).nullable(),
    amount: money,
  })
  .strict();

const orderEntryCommonResponseSchema = {
  id: uuidv7,
  campaignId: uuidv7,
  ordererName: z.string().min(1).max(200),
  memberId: uuid,
  memberName: z.string().min(1).max(200),
  lines: z.array(orderLineResponseSchema).min(1).max(100),
  totalAmount: money,
  paymentStatus: z.enum(['unpaid', 'paid']),
  paymentConfirmedAt: dateTime.nullable(),
  createdAt: dateTime,
};

const orderEntryPublicResponseSchema = z
  .object(orderEntryCommonResponseSchema)
  .strict();

const orderEntryManagerResponseSchema = z
  .object({
    ...orderEntryCommonResponseSchema,
    paymentConfirmedBy: z.string().min(1).max(128).nullable(),
  })
  .strict();

function orderEntryResponseSchemaForRole(
  role: 'owner' | 'admin' | 'staff' | 'guardian',
) {
  return role === 'owner' || role === 'admin'
    ? orderEntryManagerResponseSchema
    : orderEntryPublicResponseSchema;
}

export const orderCampaignListResponseSchema = z
  .object({ data: z.array(orderCampaignResponseSchema).max(1000) })
  .strict();

export const orderCampaignResponseEnvelopeSchema = z
  .object({ data: orderCampaignResponseSchema })
  .strict();

export const orderProductResponseEnvelopeSchema = z
  .object({ data: orderProductWithCampaignResponseSchema })
  .strict();

export function orderEntryListResponseSchemaForRole(
  role: 'owner' | 'admin' | 'staff' | 'guardian',
) {
  return z
    .object({ data: z.array(orderEntryResponseSchemaForRole(role)).max(1000) })
    .strict();
}

export function orderEntryResponseEnvelopeSchemaForRole(
  role: 'owner' | 'admin' | 'staff' | 'guardian',
) {
  return z.object({ data: orderEntryResponseSchemaForRole(role) }).strict();
}

const orderSummaryResponseSchema = z
  .object({
    totalOrders: z.number().int().min(0),
    totalAmount: money,
    paidAmount: money,
    unpaidAmount: money,
    byProduct: z
      .array(
        z
          .object({
            productId: uuidv7,
            productName: z.string().min(1).max(200),
            selectedOptions: z.record(
              z.string().min(1).max(100),
              z.string().min(1).max(100),
            ),
            quantity: z.number().int().min(0).max(1_000_000),
            amount: money,
          })
          .strict(),
      )
      .max(1000),
    unpaid: z
      .array(
        z
          .object({
            entryId: uuidv7,
            ordererName: z.string().min(1).max(200),
            memberName: z.string().min(1).max(200),
            amount: money,
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();

export const orderSummaryResponseEnvelopeSchema = z
  .object({ data: orderSummaryResponseSchema })
  .strict();
