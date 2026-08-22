import { z } from 'zod';

export const MAX_ANNOUNCEMENT_TITLE_LENGTH = 200;
export const MAX_ANNOUNCEMENT_BODY_LENGTH = 20000;
export const MAX_ANNOUNCEMENT_ATTACHMENTS = 10;

const attachmentIdsSchema = z
  .array(z.string().uuid())
  .max(MAX_ANNOUNCEMENT_ATTACHMENTS)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: 'custom',
        message: '同じ添付を複数回指定できません。',
      });
  });

// 回覧本文の上限と添付数をAPI境界で固定し、無制限の保存や大量参照を防ぐ。
export const announcementCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_ANNOUNCEMENT_TITLE_LENGTH),
    body: z.string().trim().min(1).max(MAX_ANNOUNCEMENT_BODY_LENGTH),
    attachmentIds: attachmentIdsSchema.optional().default([]),
  })
  .strict();

// 一覧のページサイズを制限し、利用者が他テナントの検索条件を注入できない形にする。
export const announcementListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const announcementIdSchema = z.string().uuid();

export type AnnouncementCreateInput = z.infer<typeof announcementCreateSchema>;
export type AnnouncementListQuery = z.infer<typeof announcementListQuerySchema>;
