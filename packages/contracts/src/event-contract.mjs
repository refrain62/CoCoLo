import { z } from 'zod';

const uuid = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });
const optionalText = (max) => z.string().trim().max(max).nullable().optional();

const eventFields = {
  title: z.string().trim().min(1).max(200),
  type: z.enum(['practice', 'match', 'event']),
  startsAt: dateTime,
  endsAt: dateTime,
  location: optionalText(500),
  itemsToBring: optionalText(2000),
  fee: z.number().int().min(0).max(1_000_000).default(0),
  announcementImageAttachmentId: uuid.nullable().optional(),
  opponent: optionalText(200),
  meetingTime: dateTime.nullable().optional(),
  transportationRequired: z.boolean().default(false),
  attendanceDeadline: dateTime,
};

const eventUpdateFields = {
  title: eventFields.title,
  type: eventFields.type,
  startsAt: eventFields.startsAt,
  endsAt: eventFields.endsAt,
  location: optionalText(500),
  itemsToBring: optionalText(2000),
  fee: z.number().int().min(0).max(1_000_000),
  announcementImageAttachmentId: uuid.nullable().optional(),
  opponent: optionalText(200),
  meetingTime: dateTime.nullable().optional(),
  transportationRequired: z.boolean(),
  attendanceDeadline: dateTime,
};

function validateEventTimes(value, context) {
  const startsAt = Date.parse(value.startsAt);
  const endsAt = Date.parse(value.endsAt);
  const deadline = Date.parse(value.attendanceDeadline);
  if (endsAt <= startsAt)
    context.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: '終了時刻は開始時刻より後にしてください。',
    });
  if (deadline > startsAt)
    context.addIssue({
      code: 'custom',
      path: ['attendanceDeadline'],
      message: '出欠締切は開始時刻以前にしてください。',
    });
  if (value.type === 'match' && !value.opponent)
    context.addIssue({
      code: 'custom',
      path: ['opponent'],
      message: '試合には対戦相手を入力してください。',
    });
  if (value.meetingTime && Date.parse(value.meetingTime) > startsAt)
    context.addIssue({
      code: 'custom',
      path: ['meetingTime'],
      message: '集合時刻は開始時刻以前にしてください。',
    });
}

// 予定の時刻関係と種別固有の必須項目をAPI境界で固定し、締切後の判定をサーバー側へ委譲する。
export const eventCreateSchema = z
  .object(eventFields)
  .strict()
  .superRefine(validateEventTimes);

export const eventUpdateSchema = z
  .object(
    Object.fromEntries(
      Object.entries(eventUpdateFields).map(([key, schema]) => [
        key,
        schema.optional(),
      ]),
    ),
  )
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: '変更項目を1つ以上指定してください。',
  });

export const eventListQuerySchema = z
  .object({
    from: dateTime,
    to: dateTime,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.to) <= Date.parse(value.from))
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: '検索終了時刻は開始時刻より後にしてください。',
      });
  });

export const attendanceResponseSchema = z.enum([
  'attending',
  'absent',
  'pending',
]);

export const attendanceUpsertSchema = z
  .object({
    memberId: uuid,
    response: attendanceResponseSchema,
    correctionReason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const eventIdSchema = uuid;
