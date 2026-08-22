import type { Prisma } from '@prisma/client';

export type NotificationOutboxSource = 'event' | 'deadline' | 'bulletin';

export type NotificationOutboxInput = {
  tenantId: string;
  actorUserId: string;
  sourceType: NotificationOutboxSource;
  sourceId: string;
  title: string;
  body: string;
  deepLink: string;
  deliverAt: Date;
};

// 業務データと同じtransactionから通知依頼だけを記録し、外部API呼び出しはworkerへ分離する。
export async function enqueueNotificationOutbox(
  client: Prisma.TransactionClient,
  input: NotificationOutboxInput,
): Promise<void> {
  await client.$executeRaw`
    SELECT app_enqueue_line_notification_outbox(
      ${input.tenantId}::uuid,
      ${input.actorUserId},
      ${input.sourceType}::line_notification_source,
      ${input.sourceId},
      ${input.title},
      ${input.body},
      ${input.deepLink},
      ${input.deliverAt}
    )
  `;
}
