import { z } from 'zod';

const targetIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,254}$/;
const groupIdPattern = /^C[A-Za-z0-9_-]{2,254}$/;
const eventIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const notificationPathPattern =
  /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+(?:\?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]+)?$/;

export const lineTargetTypeSchema = z.enum(['group', 'official_account']);
export const lineNotificationTypeSchema = z.enum([
  'schedule',
  'deadline',
  'announcement',
]);

const targetIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(255)
  .regex(targetIdPattern, 'LINEの送信先IDが不正です。');

const lineBindingInputSchema = z
  .object({
    targetType: lineTargetTypeSchema,
    targetId: targetIdSchema.optional(),
    groupId: targetIdSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.targetId && !value.groupId)
      context.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: '送信先IDが必要です。',
      });
    if (value.targetId && value.groupId)
      context.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'targetIdとgroupIdは同時に指定できません。',
      });
    const targetId = value.targetId ?? value.groupId;
    if (
      value.targetType === 'group' &&
      targetId &&
      !groupIdPattern.test(targetId)
    )
      context.addIssue({
        code: 'custom',
        path: [value.targetId ? 'targetId' : 'groupId'],
        message: 'グループIDはLINEのgroupId形式で指定してください。',
      });
  });

export const lineBindingSchema = z
  .object({
    targetType: lineTargetTypeSchema,
    targetId: targetIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.targetType === 'group' && !groupIdPattern.test(value.targetId))
      context.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'グループIDはLINEのgroupId形式で指定してください。',
      });
  });

const linePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(notificationPathPattern, '通知リンクのパスが不正です。');

export const lineNotificationCreateSchema = z
  .object({
    eventType: lineNotificationTypeSchema,
    eventId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(eventIdPattern, 'イベントIDが不正です。'),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(4500),
    deepLinkPath: linePathSchema.optional(),
    idempotencyKey: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(eventIdPattern, 'Idempotency-Keyが不正です。')
      .optional(),
  })
  .strict();

const webhookSourceSchema = z
  .object({
    type: z.enum(['user', 'group', 'room']),
    userId: z.string().trim().min(1).max(255).optional(),
    groupId: z.string().trim().min(1).max(255).optional(),
    roomId: z.string().trim().min(1).max(255).optional(),
  })
  .passthrough();

const webhookEventSchema = z
  .object({
    webhookEventId: z.string().trim().min(1).max(128),
    type: z.string().trim().min(1).max(64),
    source: webhookSourceSchema.optional(),
    timestamp: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const lineWebhookPayloadSchema = z
  .object({
    destination: targetIdSchema.optional(),
    events: z.array(webhookEventSchema).max(100),
  })
  .strict();

export class LineContractError extends Error {
  constructor(message = 'LINE通知の入力が不正です。') {
    super(message);
    this.name = 'LineContractError';
  }
}

function parse(schema, input) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new LineContractError();
  return parsed.data;
}

export function parseLineBindingInput(input) {
  const parsed = parse(lineBindingInputSchema, input);
  return {
    targetType: parsed.targetType,
    targetId: parsed.targetId ?? parsed.groupId,
  };
}

export function parseLineBinding(input) {
  return parse(lineBindingSchema, input);
}

export function parseLineNotificationCreate(input) {
  return parse(lineNotificationCreateSchema, input);
}

export function parseLineWebhookPayload(input) {
  return parse(lineWebhookPayloadSchema, input);
}
