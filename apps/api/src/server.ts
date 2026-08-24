import { createSupabaseTokenVerifier } from '@cocolo/auth';
import { createMemberRepositories, createPrismaClient } from '@cocolo/db';
import { createAttachmentRepositories } from '@cocolo/db/attachment';
import { createAuthTeamSelectionRepository } from '@cocolo/db/auth-team-selection';
import { createBoardContactRepository } from '@cocolo/db/board-contact';
import { createBulletinBoardRepositories } from '@cocolo/db/bulletin-board';
import { createEventRepository } from '@cocolo/db/events';
import { createPrismaOrdersRepository } from '@cocolo/db/orders';
import { createRideRepository } from '@cocolo/db/ride';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createR2AttachmentStorageFromEnv } from './features/attachments/r2-real-attachment-storage.js';
import { createRideService } from './features/ride-operations/ride-service.js';
import { readRuntimeEnvironment } from './runtime-environment.js';
import { loadDistributedRateLimitAdapter } from './security/rate-limit-adapter.js';
import { createStructuredLogger } from './security/structured-logger.js';

// 起動時に環境境界を検証してから、JWT検証とRLS付きrepositoryを組み立てる。
const runtime = readRuntimeEnvironment(process.env);
const port = Number(process.env.PORT ?? 8787);
const prisma = createPrismaClient();
const repositories = createMemberRepositories(prisma);
const eventRepository = createEventRepository(prisma, {
  notificationPublicAppUrl: runtime.publicAppUrl,
});
const centralFeatures = {
  authTeamSelection: {
    repository: createAuthTeamSelectionRepository(prisma),
  },
  attachments: {
    repository: createAttachmentRepositories(prisma).attachmentRepository,
    storage: createR2AttachmentStorageFromEnv(process.env),
  },
  boardContact: {
    repository: createBoardContactRepository(prisma),
  },
  bulletinBoard: {
    repository: createBulletinBoardRepositories(prisma).bulletinBoardRepository,
  },
  orders: {
    repository: createPrismaOrdersRepository(prisma),
  },
  ride: {
    service: createRideService(createRideRepository(prisma)),
  },
};
const distributedRateLimitAdapter = runtime.rateLimitAdapterModule
  ? await loadDistributedRateLimitAdapter(runtime.rateLimitAdapterModule)
  : undefined;
const app = createApp({
  verifyToken: createSupabaseTokenVerifier({
    jwksUrl: runtime.supabaseJwksUrl,
    issuer: runtime.supabaseIssuer,
  }),
  rateLimit: {
    environment: runtime.appEnv,
    mode: runtime.rateLimitStoreMode,
    namespace: runtime.rateLimitNamespace,
    adapter: distributedRateLimitAdapter,
  },
  cors: { origins: runtime.publicAppUrlAllowlist },
  observability: {
    environment: runtime.appEnv,
    logger: createStructuredLogger(),
    pathResolver: (context) => context.req.path,
  },
  ...repositories,
  eventRepository,
  centralFeatures,
});
serve({ fetch: app.fetch, port });
console.log(`CoCoLo API listening on ${port}`);
