import { createSupabaseTokenVerifier } from '@cocolo/auth';
import { createMemberRepositories, createPrismaClient } from '@cocolo/db';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { readRuntimeEnvironment } from './runtime-environment.js';
import { loadDistributedRateLimitAdapter } from './security/rate-limit-adapter.js';
import { createStructuredLogger } from './security/structured-logger.js';

// 起動時に環境境界を検証してから、JWT検証とRLS付きrepositoryを組み立てる。
const runtime = readRuntimeEnvironment(process.env);
const port = Number(process.env.PORT ?? 8787);
const prisma = createPrismaClient();
const repositories = createMemberRepositories(prisma);
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
});
serve({ fetch: app.fetch, port });
console.log(`CoCoLo API listening on ${port}`);
