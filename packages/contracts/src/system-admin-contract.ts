import { z } from 'zod';
import { uuidv7Schema } from './auth-team-selection-contract.ts';

export const systemAnnouncementStatusSchema = z.enum([
  'draft',
  'published',
  'archived',
]);

const systemAnnouncementItemSchema = z
  .object({
    id: uuidv7Schema,
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(5000),
    status: systemAnnouncementStatusSchema,
    publishedAt: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const systemAnnouncementListResponseSchema = z
  .object({ data: z.array(systemAnnouncementItemSchema).max(500) })
  .strict();

const globalAnnouncementItemSchema = z
  .object({
    id: uuidv7Schema,
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(5000),
    status: z.literal('published'),
    publishedAt: z.string().datetime({ offset: true }),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const globalAnnouncementListResponseSchema = z
  .object({ data: z.array(globalAnnouncementItemSchema).max(500) })
  .strict();

export const systemAnnouncementResponseSchema = z
  .object({ data: systemAnnouncementItemSchema })
  .strict();

export const systemAnnouncementCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(5000),
    status: systemAnnouncementStatusSchema.default('draft'),
  })
  .strict();

export const systemAnnouncementUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().trim().min(1).max(5000).optional(),
    status: systemAnnouncementStatusSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: '更新項目がありません。',
  });

const systemFeatureItemSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9._-]{1,63}$/),
    billingType: z.enum(['free', 'paid']),
    displayName: z.string().min(1).max(200),
    systemEnabled: z.boolean(),
  })
  .strict();

export const systemFeatureListResponseSchema = z
  .object({ data: z.array(systemFeatureItemSchema).max(100) })
  .strict();

export const systemFeatureResponseSchema = z
  .object({ data: systemFeatureItemSchema })
  .strict();

export const systemFeatureUpdateSchema = z
  .object({
    enabled: z.boolean(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type SystemAnnouncementStatus = z.infer<
  typeof systemAnnouncementStatusSchema
>;
export type SystemAnnouncementCreate = z.infer<
  typeof systemAnnouncementCreateSchema
>;
export type SystemAnnouncementUpdate = z.infer<
  typeof systemAnnouncementUpdateSchema
>;
export type SystemFeatureUpdate = z.infer<typeof systemFeatureUpdateSchema>;
