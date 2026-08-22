import { createAttachmentRepositories } from '@cocolo/db/attachment';
import { createBoardContactRepository } from '@cocolo/db/board-contact';
import { createBulletinBoardRepositories } from '@cocolo/db/bulletin-board';
import { createEventRepository } from '@cocolo/db/events';
import { createInMemoryOrdersRepository } from '@cocolo/db/orders';
import { createRideRepository } from '@cocolo/db/ride';
import type { CentralFeatureDependencies } from './central-dependencies.js';
import { createR2AttachmentStorageFromEnv } from './features/attachments/r2-real-attachment-storage.js';
import { createRideService } from './features/ride-operations/ride-service.js';

type AppEnvironment = 'local' | 'staging' | 'production';
type PrismaClient = Parameters<typeof createEventRepository>[0];

type CentralFeatureDependencyInput = {
  client: PrismaClient;
  appEnv: AppEnvironment;
  environment: Record<string, string | undefined>;
};

// DB schemaと各featureのrepositoryを同じPrisma clientへ束ねる。未対応の外部依存は返さず、中央APIの503を維持する。
export function createCentralFeatureDependencies({
  client,
  appEnv,
  environment,
}: CentralFeatureDependencyInput): CentralFeatureDependencies {
  const attachments = createAttachmentRepositories(client);
  const bulletinBoard = createBulletinBoardRepositories(client);

  const dependencies: CentralFeatureDependencies = {
    events: { repository: createEventRepository(client) },
    boardContact: { repository: createBoardContactRepository(client) },
    attachments: {
      repository: attachments.attachmentRepository,
      storage: createR2AttachmentStorageFromEnv(environment),
    },
    ride: { service: createRideService(createRideRepository(client)) },
    bulletinBoard: { repository: bulletinBoard.bulletinBoardRepository },
  };

  // 注文の永続Repositoryは未実装のため、localだけ検証用adapterを接続する。本番系では機能を成功扱いにしない。
  if (appEnv === 'local')
    dependencies.orders = {
      repository: createInMemoryOrdersRepository(),
    };

  return dependencies;
}
