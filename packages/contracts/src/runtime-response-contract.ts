import { z } from 'zod';
import type { MemberRole } from './member-contract.js';

const uuidV7 = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

const memberCommon = {
  id: uuidV7,
  name: z.string().min(1).max(200),
  kana: z.string().min(1).max(200).nullable(),
  category: z.enum(['student', 'adult']),
  gradeLevel: z.number().int().min(1).max(16).nullable(),
  status: z.enum(['active', 'suspended', 'retired']),
};

const guardianMemberResponseSchema = z.object(memberCommon).strict();
const staffMemberResponseSchema = z
  .object({
    ...memberCommon,
    ageGroup: z.string().min(1).max(100).nullable(),
  })
  .strict();
const managerMemberResponseSchema = z
  .object({
    ...memberCommon,
    ageGroup: z.string().min(1).max(100).nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

// 権限ごとの公開項目をunionで固定し、DBモデルの余分な項目を外へ流さない。
export const memberPublicResponseSchema = z.union([
  guardianMemberResponseSchema,
  staffMemberResponseSchema,
  managerMemberResponseSchema,
]);

export function memberPublicResponseSchemaForRole(role: MemberRole) {
  if (role === 'guardian') return guardianMemberResponseSchema;
  if (role === 'staff') return staffMemberResponseSchema;
  if (role === 'owner' || role === 'admin') return managerMemberResponseSchema;
  throw new Error('公開response schemaのroleが不正です。');
}

export const memberListResponseSchema = z
  .object({
    data: z.array(memberPublicResponseSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
  })
  .strict();

export const memberMutationResponseSchema = z
  .object({ data: memberPublicResponseSchema })
  .strict();

export function memberListResponseSchemaForRole(role: MemberRole) {
  return z
    .object({
      data: z.array(memberPublicResponseSchemaForRole(role)),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1).max(100),
    })
    .strict();
}

export function memberMutationResponseSchemaForRole(role: MemberRole) {
  return z.object({ data: memberPublicResponseSchemaForRole(role) }).strict();
}

const promotionChangeSchema = z
  .object({
    id: z.string().uuid(),
    fromGradeLevel: z.number().int().min(1).max(99),
    toGradeLevel: z.number().int().min(1).max(99),
  })
  .strict();

const promotionSuccessResultSchema = z
  .object({
    promotedCount: z.number().int().min(0),
    changes: z.array(promotionChangeSchema).max(10000),
  })
  .strict();

const promotionFailureResultSchema = z
  .object({ errorCode: z.literal('PROMOTION_GRADE_LIMIT') })
  .strict();

const promotionResultSchema = z.union([
  z.null(),
  promotionSuccessResultSchema,
  promotionFailureResultSchema,
]);

export const promotionResponseSchema = z
  .object({
    data: z
      .object({
        mode: z.enum(['preview', 'execute']),
        fiscalYear: z.number().int().min(2000).max(2100),
        status: z.enum(['preview', 'completed', 'failed']),
        previewCount: z.number().int().min(0),
        promotedCount: z.number().int().min(0),
        result: promotionResultSchema,
      })
      .strict(),
  })
  .strict();

export const lineDeliveryResponseSchema = z
  .object({
    data: z
      .object({
        notificationId: z.string().uuid(),
        status: z.literal('pending'),
      })
      .strict(),
  })
  .strict();

const eventPublicResponseSchema = z
  .object({
    id: uuidV7,
    title: z.string().min(1).max(200),
    type: z.enum(['practice', 'match', 'event']),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    location: z.string().max(500).nullable(),
    itemsToBring: z.string().max(2000).nullable(),
    fee: z.number().int().min(0).max(1_000_000),
    announcementImageAttachmentId: uuidV7.nullable(),
    opponent: z.string().max(200).nullable(),
    meetingTime: z.string().datetime({ offset: true }).nullable(),
    transportationRequired: z.boolean(),
    attendanceDeadline: z.string().datetime({ offset: true }),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const eventListResponseSchema = z
  .object({ data: z.array(eventPublicResponseSchema).max(500) })
  .strict();

export const eventMutationResponseSchema = z
  .object({ data: eventPublicResponseSchema })
  .strict();

const attendanceItemResponseSchema = z
  .object({
    eventId: uuidV7,
    memberId: uuidV7,
    response: z.enum(['attending', 'absent', 'pending']),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const attendanceResponseSchema = z
  .object({ data: attendanceItemResponseSchema })
  .strict();

export const attendanceListResponseSchema = z
  .object({ data: z.array(attendanceItemResponseSchema) })
  .strict();

export const attendanceSummaryResponseSchema = z
  .object({
    data: z
      .object({
        totalMembers: z.number().int().min(0),
        attending: z.number().int().min(0),
        absent: z.number().int().min(0),
        pending: z.number().int().min(0),
        unanswered: z.number().int().min(0),
        unansweredMemberIds: z.array(uuidV7),
      })
      .strict(),
  })
  .strict();

export const authContextResponseSchema = z
  .object({
    data: z
      .object({
        tenantId: uuidV7,
        role: z.enum(['owner', 'admin', 'staff', 'guardian']),
      })
      .strict(),
  })
  .strict();

export const errorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1).max(128),
        message: z.string().min(1).max(512),
        details: z.unknown(),
        requestId: z.string().uuid(),
      })
      .strict(),
  })
  .strict();

export type RuntimeResponseSchema = {
  safeParse: (value: unknown) => { success: boolean };
};
