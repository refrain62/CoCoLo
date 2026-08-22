import { fileURLToPath } from 'node:url';
import { createPrismaClient } from '@cocolo/db';
import {
  createSqlLineDeliveryRepository,
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

// 外部schedulerから一度に一件だけ処理する。並列起動はDBのSKIP LOCKEDで別通知をclaimする。
export async function runLineDeliveryWorker(): Promise<
  'idle' | 'sent' | 'failed'
> {
  const client = createPrismaClient();
  try {
    const service = createLineDeliveryService({
      repository: createSqlLineDeliveryRepository(
        createPrismaLineSqlClient(client),
      ),
      adapter: createLineMessagingAdapter({
        channelAccessToken: required('LINE_CHANNEL_ACCESS_TOKEN'),
      }),
    });
    const notification = await service.deliverOne();
    if (!notification) return 'idle';
    return notification.status === 'sent' ? 'sent' : 'failed';
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
