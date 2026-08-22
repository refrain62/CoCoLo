import type { z } from 'zod';

export type MemberRole = 'owner' | 'admin' | 'staff' | 'guardian';
export type MemberListQuery = z.infer<typeof memberListQuerySchema>;
export type MemberCreateInput = z.infer<typeof memberCreateSchema>;
export type MemberUpdateInput = z.infer<typeof memberUpdateSchema>;
export type PromotionMode = 'preview' | 'execute';
export type PromotionRequest = z.infer<typeof promotionRequestSchema>;

export declare const memberListQuerySchema: z.ZodType<MemberListQuery>;
export declare const memberCreateSchema: z.ZodType<MemberCreateInput>;
export declare const memberUpdateSchema: z.ZodType<MemberUpdateInput>;
export declare const memberIdSchema: z.ZodString;
export declare const promotionRequestSchema: z.ZodType<PromotionRequest>;
