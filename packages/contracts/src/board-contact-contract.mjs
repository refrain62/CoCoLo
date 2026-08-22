import { z } from 'zod';

const fiscalYear = z.coerce.number().int().min(2000).max(2100);
const roleName = z.string().trim().min(1).max(100);
const roleType = z.enum(['admin', 'staff', 'member']);
const contactPreference = z.enum(['line', 'phone', 'both']);
const userId = z.string().trim().min(1).max(128);
const lineContact = z.string().trim().min(1).max(200).nullable().optional();
const phone = z
  .string()
  .trim()
  .min(7)
  .max(32)
  .regex(/^[0-9+().\-\s]+$/)
  .nullable()
  .optional();

// APIへ渡すのは役職と連絡先設定だけに限定し、tenant・ID・監査項目の注入を拒否する。
export const boardContactCreateSchema = z
  .object({
    fiscalYear,
    roleName,
    roleType,
    assigneeUserId: userId.nullable().optional(),
    lineContact,
    phone,
    contactPreference: contactPreference.default('line'),
  })
  .strict();

// 部分更新でも空のPATCHを拒否し、更新対象を許可済み項目に固定する。
export const boardContactPatchSchema = z
  .object({
    fiscalYear: fiscalYear.optional(),
    roleName: roleName.optional(),
    roleType: roleType.optional(),
    assigneeUserId: userId.nullable().optional(),
    lineContact,
    phone,
    contactPreference: contactPreference.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: '更新項目を1つ以上指定してください。',
  });

export const boardContactIdSchema = z.string().trim().min(1).max(128);

export const boardContactListQuerySchema = z
  .object({ fiscalYear: fiscalYear.optional() })
  .strict();

export const copyBoardContactYearSchema = z
  .object({ fromFiscalYear: fiscalYear, toFiscalYear: fiscalYear })
  .strict()
  .refine((value) => value.fromFiscalYear !== value.toFiscalYear, {
    message: '引き継ぎ元と引き継ぎ先の年度は異なる必要があります。',
  });

export function parseBoardContactCreate(input) {
  return boardContactCreateSchema.parse(input);
}

export function parseBoardContactPatch(input) {
  return boardContactPatchSchema.parse(input);
}

export function parseBoardContactListQuery(input) {
  return boardContactListQuerySchema.parse(input);
}

export function parseCopyBoardContactYear(input) {
  return copyBoardContactYearSchema.parse(input);
}
