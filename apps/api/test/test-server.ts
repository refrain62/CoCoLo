import { createMemberRepositories, createPrismaClient } from '@cocolo/db';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createApp } from '../src/app.js';

const testEmail = 'owner-a@example.test';
const testPassword = 'owner-password';
const testAccessToken = 'local-test-owner-token';
const appEnv = process.env.APP_ENV;
if (appEnv !== 'local')
  throw new Error('test-only Auth serverはlocal環境でのみ起動できます。');
if (!process.env.DATABASE_URL)
  throw new Error('local E2EにはDATABASE_URLが必要です。');

const prisma = createPrismaClient();
const repositories = createMemberRepositories(prisma);
const api = createApp({
  verifyToken: async (token) => {
    if (token !== testAccessToken) throw new Error('test token is invalid');
    return {
      userId: 'owner-a',
      issuer: 'http://127.0.0.1:8787/auth/v1',
      audience: 'authenticated',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
  },
  ...repositories,
});

const testAuth = new Hono();
testAuth.post('/auth/v1/token', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };
  if (body.email !== testEmail || body.password !== testPassword)
    return c.json(
      {
        error: 'invalid_grant',
        error_description: 'メールアドレスまたはパスワードが正しくありません。',
      },
      400,
    );
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  return c.json({
    access_token: testAccessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: 'local-test-refresh-token',
    user: { id: 'owner-a', email: testEmail },
  });
});
testAuth.all('*', (c) => api.fetch(c.req.raw));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: testAuth.fetch, port });
