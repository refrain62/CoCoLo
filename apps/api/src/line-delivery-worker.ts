import { fileURLToPath } from 'node:url';
import { createPrismaClient } from '@cocolo/db';
import {
  createSqlLineDeliveryRepository,
  createSqlLineOutboxRepository,
  type LineSqlClient,
} from '@cocolo/db/line';
import { createLineMessagingAdapter } from './features/line-notifications/line-messaging-adapter.js';
import { createLineDeliveryService } from './features/line-notifications/line-service.js';

type PrismaClient = ReturnType<typeof createPrismaClient>;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} が必要です。`);
  return value;
}

function batchSize(): number {
  const value = Number(process.env.LINE_DELIVERY_BATCH_SIZE ?? 10);
  if (!Number.isInteger(value) || value < 1 || value > 100)
    throw new Error('LINE_DELIVERY_BATCH_SIZE が不正です。');
  return value;
}

function createPrismaLineSqlClient(client: PrismaClient): LineSqlClient {
  return {
    transaction: (work) =>
      client.$transaction(async (transaction) =>
        work({
          query: async <Row>(sql: string, values: readonly unknown[]) => ({
            rows: (await transaction.$queryRawUnsafe(sql, ...values)) as Row[],
          }),
        }),
      ),
  };
}

// 外部schedulerからoutboxとqueueを限定件数だけ処理する。並列起動はDBのSKIP LOCKEDで分担する。
export async function runLineDeliveryWorker(): Promise<
  'idle' | 'sent' | 'failed'
> {
  const client = createPrismaClient();
  try {
    const channelAccessToken = required('LINE_CHANNEL_ACCESS_TOKEN');
    const sqlClient = createPrismaLineSqlClient(client);
    const now = new Date();
    const limit = batchSize();
    const outbox = createSqlLineOutboxRepository(sqlClient);
    for (let index = 0; index < limit; index += 1) {
      const outcome = await outbox.processOne({ now, maxAttempts: 5 });
      if (outcome === 'idle') break;
    }
    const service = createLineDeliveryService({
      repository: createSqlLineDeliveryRepository(sqlClient),
      adapter: createLineMessagingAdapter({
        channelAccessToken,
      }),
    });
    let result: 'idle' | 'sent' | 'failed' = 'idle';
    for (let index = 0; index < limit; index += 1) {
      const notification = await service.deliverOne(now);
      if (!notification) break;
      result = notification.status === 'sent' ? 'sent' : 'failed';
    }
    return result;
  } finally {
    await client.$disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly)
  runLineDeliveryWorker()
    .then((status) => {
      console.log(JSON.stringify({ status }));
    })
    .catch(() => {
      console.error('LINE配信workerが失敗しました。');
      process.exitCode = 1;
    });
