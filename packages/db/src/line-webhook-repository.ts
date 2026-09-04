import type { PrismaClient } from '@prisma/client';

export type LineWebhookReceiptInput = Readonly<{
  groupId: string;
  webhookEventId: string;
  receivedAt: Date;
}>;

export type LineWebhookReceiptResult = 'accepted' | 'duplicate' | 'ignored';

export type LineWebhookRepository = {
  recordWebhookReceipt: (
    input: LineWebhookReceiptInput,
  ) => Promise<LineWebhookReceiptResult>;
};

// 受信専用DB roleは、直接テーブルへ触れず、境界関数の結果だけを受け取る。
export function createPrismaLineWebhookRepository(
  client: PrismaClient,
): LineWebhookRepository {
  return {
    async recordWebhookReceipt(input) {
      const rows = await client.$queryRawUnsafe<
        Array<{ accepted: boolean; known_group: boolean }>
      >(
        `SELECT accepted, known_group
           FROM app_record_line_webhook_receipt($1, $2, $3)`,
        input.groupId,
        input.webhookEventId,
        input.receivedAt,
      );
      const row = rows[0];
      if (!row?.known_group) return 'ignored';
      return row.accepted ? 'accepted' : 'duplicate';
    },
  };
}
