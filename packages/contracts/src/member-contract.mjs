import { z } from 'zod';

// 任意文字列もtrim後に空文字を許可しないことで、nullと未指定を明確に分ける。
const optionalTrimmedString = (max) =>
  z.string().trim().min(1).max(max).nullable().optional();

// 一覧条件はAPI境界で正規化し、ページサイズと検索語の上限を固定する。
export const memberListQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    status: z.enum(['active', 'suspended', 'retired']).optional(),
    category: z.enum(['student', 'adult']).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

// 部員区分ごとの学年・年代の排他条件を契約層で保証し、APIとDBの不整合を防ぐ。
export const memberCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    kana: optionalTrimmedString(200),
    category: z.enum(['student', 'adult']),
    gradeLevel: z.number().int().min(1).max(16).nullable().optional(),
    ageGroup: optionalTrimmedString(100),
    status: z.enum(['active', 'suspended']).default('active'),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.category === 'student' && value.gradeLevel == null)
      context.addIssue({
        code: 'custom',
        path: ['gradeLevel'],
        message: 'studentにはgradeLevelが必要です',
      });
    if (value.category === 'student' && value.ageGroup != null)
      context.addIssue({
        code: 'custom',
        path: ['ageGroup'],
        message: 'studentにはageGroupを指定できません',
      });
    if (value.category === 'adult' && value.ageGroup == null)
      context.addIssue({
        code: 'custom',
        path: ['ageGroup'],
        message: 'adultにはageGroupが必要です',
      });
    if (value.category === 'adult' && value.gradeLevel != null)
      context.addIssue({
        code: 'custom',
        path: ['gradeLevel'],
        message: 'adultにはgradeLevelを指定できません',
      });
  });

export const promotionRequestSchema = z
  .object({
    mode: z.enum(['preview', 'execute']),
    fiscalYear: z.number().int().min(2000).max(2100),
  })
  .strict();
