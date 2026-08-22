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
