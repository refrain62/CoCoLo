import type { z } from 'zod';

export const lineTargetTypeSchema: z.ZodEnum<{
  group: 'group';
  official_account: 'official_account';
}>;
export const lineNotificationTypeSchema: z.ZodEnum<{
  schedule: 'schedule';
  deadline: 'deadline';
  announcement: 'announcement';
}>;
export const lineBindingSchema: z.ZodType<unknown>;
export const lineNotificationCreateSchema: z.ZodType<unknown>;
export const lineWebhookPayloadSchema: z.ZodType<unknown>;

export class LineContractError extends Error {}

export function parseLineBindingInput(input: unknown): {
  targetType: 'group' | 'official_account';
  targetId: string;
};
export function parseLineBinding(input: unknown): {
  targetType: 'group' | 'official_account';
  targetId: string;
};
export function parseLineNotificationCreate(input: unknown): {
  eventType: 'schedule' | 'deadline' | 'announcement';
  eventId: string;
  title: string;
  body: string;
  deepLinkPath?: string;
  idempotencyKey?: string;
};
export function parseLineWebhookPayload(input: unknown): {
  destination?: string;
  events: Array<{
    webhookEventId: string;
    type: string;
    source?: {
      type: 'user' | 'group' | 'room';
      userId?: string;
      groupId?: string;
      roomId?: string;
      [key: string]: unknown;
    };
    timestamp?: number;
    [key: string]: unknown;
  }>;
};
