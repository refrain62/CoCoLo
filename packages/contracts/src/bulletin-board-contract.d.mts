import type { z } from 'zod';

export declare const MAX_ANNOUNCEMENT_TITLE_LENGTH = 200;
export declare const MAX_ANNOUNCEMENT_BODY_LENGTH = 20000;
export declare const MAX_ANNOUNCEMENT_ATTACHMENTS = 10;

export type AnnouncementCreateInput = {
  title: string;
  body: string;
  attachmentIds: string[];
};
export type AnnouncementListQuery = {
  page: number;
  pageSize: number;
};

export declare const announcementCreateSchema: z.ZodType<AnnouncementCreateInput>;
export declare const announcementListQuerySchema: z.ZodType<AnnouncementListQuery>;
export declare const announcementIdSchema: z.ZodType<string>;
