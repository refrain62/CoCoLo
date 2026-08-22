import { createSupabaseTokenVerifier } from '@cocolo/auth';
import { createMemberRepositories, createPrismaClient } from '@cocolo/db';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { readRuntimeEnvironment } from './runtime-environment.js';

const runtime = readRuntimeEnvironment(process.env);
const port = Number(process.env.PORT ?? 8787);
const prisma = createPrismaClient();
const repositories = createMemberRepositories(prisma);
const app = createApp({
  verifyToken: createSupabaseTokenVerifier({
    jwksUrl: runtime.supabaseJwksUrl,
    issuer: runtime.supabaseIssuer,
  }),
  ...repositories,
});
serve({ fetch: app.fetch, port });
console.log(`CoCoLo API listening on ${port}`);
