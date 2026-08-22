import { createSupabaseTokenVerifier } from '@cocolo/auth';
import { createMemberRepositories, createPrismaClient } from '@cocolo/db';
import { createAuthTeamSelectionRepository } from '@cocolo/db/auth-team-selection';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createCentralDatabaseAdapter } from './central-dependencies.js';
import { createCentralFeatureDependencies } from './central-feature-dependencies.js';
import { readRuntimeEnvironment } from './runtime-environment.js';

// 起動時に環境境界を検証してから、JWT検証とRLS付きrepositoryを組み立てる。
const runtime = readRuntimeEnvironment(process.env);
const port = Number(process.env.PORT ?? 8787);
const prisma = createPrismaClient();
const repositories = createMemberRepositories(prisma);
const corsOrigins = (
  process.env.PUBLIC_APP_URL_ALLOWLIST ??
  process.env.PUBLIC_APP_URL ??
  ''
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const app = createApp({
  verifyToken: createSupabaseTokenVerifier({
    jwksUrl: runtime.supabaseJwksUrl,
    issuer: runtime.supabaseIssuer,
  }),
  ...repositories,
  central: {
    database: createCentralDatabaseAdapter(prisma),
    environment: runtime.appEnv,
    corsOrigins,
    features: {
      ...createCentralFeatureDependencies({
        client: prisma,
        appEnv: runtime.appEnv,
        environment: process.env,
      }),
      authTeamSelection: {
        repository: createAuthTeamSelectionRepository(prisma),
      },
    },
    // 分散storeを渡さない限りstaging/productionは起動時に停止する。
    requireDistributedRateLimitStore: runtime.appEnv !== 'local',
  },
});
serve({ fetch: app.fetch, port });
console.log(`CoCoLo API listening on ${port}`);
