import type { z } from 'zod';

export type MemberRole = 'owner' | 'admin' | 'staff' | 'guardian';
export type MemberListQuery = z.infer<typeof memberListQuerySchema>;
export type MemberCreateInput = z.infer<typeof memberCreateSchema>;

export declare const memberListQuerySchema: z.ZodType<MemberListQuery>;
export declare const memberCreateSchema: z.ZodType<MemberCreateInput>;
