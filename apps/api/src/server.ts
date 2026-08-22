import { createSupabaseTokenVerifier } from '@cocolo/auth';
import { createMemberRepositories, createPrismaClient } from '@cocolo/db';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 8787);
const supabaseJwksUrl = process.env.SUPABASE_JWKS_URL;
const supabaseIssuer =
  process.env.SUPABASE_ISSUER ??
  (process.env.SUPABASE_URL
    ? `${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`
    : undefined);
if (!supabaseJwksUrl || !supabaseIssuer)
  throw new Error('SUPABASE_URLまたはSUPABASE_JWKS_URLが必要です');
const prisma = createPrismaClient();
const repositories = createMemberRepositories(prisma);
const app = createApp({
  verifyToken: createSupabaseTokenVerifier({
    jwksUrl: supabaseJwksUrl,
    issuer: supabaseIssuer,
  }),
  ...repositories,
});
serve({ fetch: app.fetch, port });
console.log(`CoCoLo API listening on ${port}`);
