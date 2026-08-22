import { createAttachmentRepositories } from '@cocolo/db/attachment';
import { createBoardContactRepository } from '@cocolo/db/board-contact';
import { createBulletinBoardRepositories } from '@cocolo/db/bulletin-board';
import { createEventRepository } from '@cocolo/db/events';
import {
  createSqlLineRepository,
  type LineActor,
  type LineSqlClient,
} from '@cocolo/db/line';
import { createPrismaOrdersRepository } from '@cocolo/db/orders-persistent';
import { createRideRepository } from '@cocolo/db/ride';
import type { CentralFeatureDependencies } from './central-dependencies.js';
import { createR2AttachmentStorageFromEnv } from './features/attachments/r2-real-attachment-storage.js';
import { createLineMessagingAdapter } from './features/line-notifications/line-messaging-adapter.js';
import { createLineNotificationService } from './features/line-notifications/line-service.js';
import { createRideService } from './features/ride-operations/ride-service.js';

type AppEnvironment = 'local' | 'staging' | 'production';
type PrismaClient = Parameters<typeof createEventRepository>[0];

type CentralFeatureDependencyInput = {
  client: PrismaClient;
  appEnv: AppEnvironment;
  environment: Record<string, string | undefined>;
};

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

function actorFromInput(input: unknown): LineActor | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Partial<LineActor>;
  if (
    typeof value.tenantId !== 'string' ||
    typeof value.userId !== 'string' ||
    typeof value.role !== 'string'
  )
    return null;
  return value as LineActor;
}

// DB schemaと各featureのrepositoryを同じPrisma clientへ束ねる。未対応の外部依存は返さず、中央APIの503を維持する。
export function createCentralFeatureDependencies({
  client,
  appEnv: _appEnv,
  environment,
}: CentralFeatureDependencyInput): CentralFeatureDependencies {
  const publicAppUrl = environment.PUBLIC_APP_URL?.trim();
  const attachments = createAttachmentRepositories(client);
  const bulletinBoard = createBulletinBoardRepositories(client, {
    notificationPublicAppUrl: publicAppUrl,
  });

  const dependencies: CentralFeatureDependencies = {
    events: {
      repository: createEventRepository(client, {
        notificationPublicAppUrl: publicAppUrl,
      }),
    },
    boardContact: { repository: createBoardContactRepository(client) },
    attachments: {
      repository: attachments.attachmentRepository,
      storage: createR2AttachmentStorageFromEnv(environment),
    },
    ride: { service: createRideService(createRideRepository(client)) },
    bulletinBoard: { repository: bulletinBoard.bulletinBoardRepository },
  };

  // 注文も中央migrationのPrisma modelへ接続し、localと本番系で保存経路を分けない。
  dependencies.orders = { repository: createPrismaOrdersRepository(client) };

  const lineChannelSecret = environment.LINE_CHANNEL_SECRET?.trim();
  const lineChannelAccessToken = environment.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  const lineWebhookDestination = environment.LINE_WEBHOOK_DESTINATION?.trim();
  if (
    lineChannelSecret &&
    lineChannelAccessToken &&
    lineWebhookDestination &&
    publicAppUrl
  ) {
    const repository = createSqlLineRepository(
      createPrismaLineSqlClient(client),
      {
        resolveActor: (_operation, input) => actorFromInput(input),
      },
    );
    dependencies.line = {
      service: createLineNotificationService({
        repository,
        adapter: createLineMessagingAdapter({
          channelAccessToken: lineChannelAccessToken,
        }),
        channelSecret: lineChannelSecret,
        webhookDestination: lineWebhookDestination,
        publicAppUrl,
        liffId: environment.LINE_LIFF_ID?.trim() || undefined,
      }),
    };
  }

  return dependencies;
}
