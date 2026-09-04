import { z } from 'zod';

const attachmentMediaType = z.enum([
  'image/jpeg',
  'image/png',
  'application/pdf',
]);

const announcementAttachmentResponseSchema = z
  .object({
    id: z.string().uuid(),
    mediaType: attachmentMediaType,
    byteSize: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024),
  })
  .strict();

const announcementSummaryResponseSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(200),
    status: z.enum(['published', 'archived']),
    publishedAt: z.string().datetime({ offset: true }),
    attachmentCount: z.number().int().min(0).max(10),
    readAt: z.string().datetime({ offset: true }).nullable(),
    isRead: z.boolean(),
    isAuthor: z.boolean(),
  })
  .strict();

export const announcementListResponseSchema = z
  .object({
    data: z.array(announcementSummaryResponseSchema).max(100),
    page: z.number().int().min(1).max(10000),
    pageSize: z.number().int().min(1).max(100),
    hasNext: z.boolean(),
  })
  .strict();

export const announcementResponseEnvelopeSchema = z
  .object({
    data: z
      .object({
        ...announcementSummaryResponseSchema.shape,
        body: z.string().min(1).max(20000),
        attachments: z.array(announcementAttachmentResponseSchema).max(10),
        canViewUnread: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const announcementReadResponseSchema = z
  .object({
    data: z
      .object({
        readAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  })
  .strict();

export const announcementUnreadResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            userId: z.string().min(1).max(128),
            role: z.enum(['owner', 'admin', 'staff', 'guardian']),
          })
          .strict(),
      )
      .max(1000),
    unreadCount: z.number().int().min(0).max(1000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.data.length !== value.unreadCount)
      context.addIssue({
        code: 'custom',
        path: ['unreadCount'],
        message: '未読者数と未読者一覧の件数が一致しません。',
      });
  });
