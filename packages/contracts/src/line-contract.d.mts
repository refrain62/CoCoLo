import type { z } from 'zod';

export type LineNotificationSource = z.infer<
  typeof lineNotificationSourceSchema
>;
export type LineConnectInput = z.infer<typeof lineConnectInputSchema>;
export type LineNotificationInput = z.infer<typeof lineNotificationInputSchema>;
export type LineWebhookEvent = z.infer<typeof lineWebhookEventSchema>;
export type LineWebhookBody = z.infer<typeof lineWebhookBodySchema>;

export declare const lineNotificationSourceSchema: z.ZodEnum<{
  event: 'event';
  deadline: 'deadline';
  bulletin: 'bulletin';
}>;
export declare const lineConnectInputSchema: z.ZodType<LineConnectInput>;
export declare const lineNotificationInputSchema: z.ZodType<LineNotificationInput>;
export declare const lineWebhookEventSchema: z.ZodType<LineWebhookEvent>;
export declare const lineWebhookBodySchema: z.ZodType<LineWebhookBody>;
export declare const lineNotificationResponseSchema: z.ZodType<unknown>;
export declare function parseLineConnectInput(
  input: unknown,
): LineConnectInput;
export declare function parseLineNotificationInput(
  input: unknown,
): LineNotificationInput;
export declare function parseLineWebhookBody(input: unknown): LineWebhookBody;
