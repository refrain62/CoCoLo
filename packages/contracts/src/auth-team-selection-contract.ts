import { z } from 'zod';

// UUIDv7だけをチーム識別子として受け付け、連番や任意文字列の混入を防ぐ。
export const uuidv7Schema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'チームIDはUUIDv7で指定してください。',
  );

export const teamSelectionRequestSchema = z
  .object({
    tenantId: uuidv7Schema,
  })
  .strict();

export const teamRoleSchema = z.enum(['owner', 'admin', 'staff', 'guardian']);

export const teamOptionSchema = z
  .object({
    tenantId: uuidv7Schema,
    tenantName: z.string().trim().min(1).max(200),
    role: teamRoleSchema,
  })
  .strict();

export const teamListResponseSchema = z
  .object({
    data: z.array(teamOptionSchema),
  })
  .strict();

export const teamSelectionResponseSchema = z
  .object({
    data: teamOptionSchema,
  })
  .strict();

// 中央統合後も、選択中チームを各業務APIへ明示的に渡すヘッダー名を固定する。
export const selectedTeamHeaderName = 'X-CoCoLo-Team-Id';

export type TeamRole = z.infer<typeof teamRoleSchema>;
export type TeamSelectionRequest = z.infer<typeof teamSelectionRequestSchema>;
export type TeamOption = z.infer<typeof teamOptionSchema>;
