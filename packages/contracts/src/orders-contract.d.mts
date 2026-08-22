import type { z } from 'zod';

export type OrderOptionInput = {
  name: string;
  values: string[];
};

export type OrderProductInput = {
  name: string;
  unitPrice: number;
  imageUrl?: string | null;
  options: OrderOptionInput[];
  requiresBackNumber: boolean;
  requiresBackName: boolean;
};

export type OrderCreateInput = {
  title: string;
  deadline: string;
  products: OrderProductInput[];
};

export type OrderEntryCreateInput = {
  memberId: string;
  ordererName: string;
  lines: Array<{
    productId: string;
    quantity: number;
    selectedOptions: Record<string, string>;
    backNumber?: string | null;
    backName?: string | null;
  }>;
};

export type OrderStatusUpdateInput = { status: 'closed' | 'completed' };
export type PaymentUpdateInput = { status: 'unpaid' | 'paid' };

export declare const orderOptionSchema: z.ZodType<OrderOptionInput>;
export declare const orderProductSchema: z.ZodType<OrderProductInput>;
export declare const orderCreateSchema: z.ZodType<OrderCreateInput>;
export declare const orderEntryCreateSchema: z.ZodType<OrderEntryCreateInput>;
export declare const orderStatusUpdateSchema: z.ZodType<OrderStatusUpdateInput>;
export declare const paymentUpdateSchema: z.ZodType<PaymentUpdateInput>;
export declare const orderListQuerySchema: z.ZodType<{ status?: 'open' | 'closed' | 'completed' }>;
export declare const paymentStatusQuerySchema: z.ZodType<{ paymentStatus?: 'unpaid' | 'paid' }>;
export declare function parseOrderCreate(input: unknown): OrderCreateInput;
export declare function parseOrderEntryCreate(input: unknown): OrderEntryCreateInput;
export declare function parseOrderStatusUpdate(input: unknown): OrderStatusUpdateInput;
export declare function parsePaymentUpdate(input: unknown): PaymentUpdateInput;
