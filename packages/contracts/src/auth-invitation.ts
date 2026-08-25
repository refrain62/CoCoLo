import { z } from 'zod';

export const authProviderSchema = z.enum(['google', 'line']);
export const invitationRoleSchema = z.literal('guardian');
export const invitationIdSchema = z.string().uuid();

export const invitationCreateSchema = z
  .object({
    memberId: z.string().uuid(),
    role: invitationRoleSchema,
    relationship: z.string().trim().min(1).max(100),
    expiresInHours: z.number().int().min(1).max(168).default(72),
  })
  .strict();

export const invitationAcceptSchema = z
  .object({
    token: z.string().trim().min(32).max(256),
    provider: authProviderSchema,
  })
  .strict();

export const invitationRevokeSchema = z
  .object({ invitationId: invitationIdSchema })
  .strict();

const invitationStatusSchema = z.enum([
  'pending',
  'accepted',
  'expired',
  'revoked',
]);

const invitationItemSchema = z
  .object({
    id: invitationIdSchema,
    memberId: z.string().uuid(),
    role: invitationRoleSchema,
    relationship: z.string().trim().min(1).max(100),
    status: invitationStatusSchema,
    expiresAt: z.string().datetime({ offset: true }),
    acceptedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export const invitationListResponseSchema = z
  .object({ data: z.array(invitationItemSchema) })
  .strict();

export const invitationResponseSchema = z
  .object({ data: invitationItemSchema })
  .strict();

export const invitationCreateResponseSchema = z
  .object({
    data: z.object({
      id: invitationIdSchema,
      memberId: z.string().uuid(),
      role: invitationRoleSchema,
      relationship: z.string().trim().min(1).max(100),
      token: z.string().trim().min(32).max(256),
      expiresAt: z.string().datetime({ offset: true }),
    }),
  })
  .strict();

export const invitationAcceptResponseSchema = z
  .object({
    data: z.object({
      tenantId: z.string().uuid(),
      memberId: z.string().uuid(),
      role: invitationRoleSchema,
      linkStatus: z.literal('active'),
    }),
  })
  .strict();

export type InvitationCreateInput = z.infer<typeof invitationCreateSchema>;
export type InvitationAcceptInput = z.infer<typeof invitationAcceptSchema>;
