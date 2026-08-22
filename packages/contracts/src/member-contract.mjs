import { z } from 'zod';

const optionalTrimmedString = (max) =>
  z.string().trim().min(1).max(max).nullable().optional();

export const memberListQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    status: z.enum(['active', 'suspended', 'retired']).optional(),
    category: z.enum(['student', 'adult']).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

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
        message: '学生の場合は学年を入力してください。',
      });
    if (value.category === 'student' && value.ageGroup != null)
      context.addIssue({
        code: 'custom',
        path: ['ageGroup'],
        message: '学生の場合、年代は指定できません。',
      });
    if (value.category === 'adult' && value.ageGroup == null)
      context.addIssue({
        code: 'custom',
        path: ['ageGroup'],
        message: '一般の場合は年代を入力してください。',
      });
    if (value.category === 'adult' && value.gradeLevel != null)
      context.addIssue({
        code: 'custom',
        path: ['gradeLevel'],
        message: '一般の場合、学年は指定できません。',
      });
  });

export const promotionRequestSchema = z
  .object({
    mode: z.enum(['preview', 'execute']),
    fiscalYear: z.number().int().min(2000).max(2100),
  })
  .strict();
