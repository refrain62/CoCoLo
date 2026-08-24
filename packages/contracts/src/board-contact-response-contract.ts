import { z } from 'zod';

const uuidV7 = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

const boardContactCommonResponseSchema = {
  id: uuidV7,
  fiscalYear: z.number().int().min(2000).max(2100),
  roleName: z.string().min(1).max(100),
  roleType: z.enum(['admin', 'staff', 'member']),
  contactPreference: z.enum(['line', 'phone', 'both']),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
};

const boardContactPublicResponseSchema = z
  .object(boardContactCommonResponseSchema)
  .strict();

const boardContactManagerResponseSchema = z
  .object({
    ...boardContactCommonResponseSchema,
    assigneeUserId: z.string().min(1).max(128).optional(),
    lineContact: z.string().min(1).max(200).optional(),
    phone: z.string().min(1).max(32).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.contactPreference === 'line' && value.phone !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['phone'],
        message: '電話番号は表示設定と一致しません。',
      });
    if (value.contactPreference === 'phone' && value.lineContact !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['lineContact'],
        message: 'LINE連絡先は表示設定と一致しません。',
      });
  });

const boardContactItemResponseSchemaForRole = (
  role: 'owner' | 'admin' | 'staff' | 'guardian',
) =>
  role === 'owner' || role === 'admin'
    ? boardContactManagerResponseSchema
    : boardContactPublicResponseSchema;

export function boardContactListResponseSchemaForRole(
  role: 'owner' | 'admin' | 'staff' | 'guardian',
) {
  return z
    .object({
      data: z.array(boardContactItemResponseSchemaForRole(role)).max(1000),
      fiscalYear: z.number().int().min(2000).max(2100).nullable(),
    })
    .strict();
}

export const boardContactManagerMutationResponseSchema = z
  .object({ data: boardContactManagerResponseSchema })
  .strict();

export const boardContactCopyYearResponseSchema = z
  .object({
    data: z.array(boardContactManagerResponseSchema).max(1000),
    copiedCount: z.number().int().min(0).max(1000),
    fromFiscalYear: z.number().int().min(2000).max(2100),
    toFiscalYear: z.number().int().min(2000).max(2100),
  })
  .strict();
