import assert from 'node:assert/strict';
import test from 'node:test';
import { memberListResponseSchema } from '@cocolo/contracts/runtime-response';
import { Hono } from 'hono';
import { createCorsMiddleware } from '../dist/security/cors.js';
import {
  createRateLimitKey,
  createRateLimitMiddleware,
  InMemoryRateLimitStore,
  rateLimitPolicies,
} from '../dist/security/rate-limit.js';
import { createResponseContractMiddleware } from '../dist/security/response-contract.js';
import {
  createRequestLoggerMiddleware,
  createStructuredLogger,
} from '../dist/security/structured-logger.js';

test('CORSはallowlist外originと不許可preflightを拒否する', async () => {
  const app = new Hono();
  app.use('*', createCorsMiddleware({ origins: ['https://app.example.com'] }));
  app.get('/api/v1/ping', (c) => c.json({ ok: true }));

  const allowedPreflight = await app.request('/api/v1/ping', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://app.example.com',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Authorization, Content-Type',
    },
  });
  assert.equal(allowedPreflight.status, 204);
  assert.equal(
    allowedPreflight.headers.get('access-control-allow-origin'),
    'https://app.example.com',
  );
  assert.equal(
    allowedPreflight.headers.get('access-control-allow-credentials'),
    null,
  );

  const deniedPreflight = await app.request('/api/v1/ping', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://evil.example.com',
      'Access-Control-Request-Method': 'GET',
    },
  });
  assert.equal(deniedPreflight.status, 403);
  assert.equal(
    deniedPreflight.headers.get('access-control-allow-origin'),
    null,
  );

  const deniedHeader = await app.request('/api/v1/ping', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://app.example.com',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'X-Secret-Header',
    },
  });
  assert.equal(deniedHeader.status, 403);
});

test('CORSは許可originだけにヘッダーを付け、Originなしの直接呼び出しを壊さない', async () => {
  const app = new Hono();
  app.use('*', createCorsMiddleware({ origins: ['https://app.example.com'] }));
  app.get('/api/v1/ping', (c) => c.json({ ok: true }));

  const allowed = await app.request('/api/v1/ping', {
    headers: { Origin: 'https://app.example.com' },
  });
  assert.equal(allowed.status, 200);
  assert.equal(
    allowed.headers.get('access-control-allow-origin'),
    'https://app.example.com',
  );
  assert.equal(allowed.headers.get('vary'), 'Origin');

  const direct = await app.request('/api/v1/ping');
  assert.equal(direct.status, 200);
  assert.equal(direct.headers.get('access-control-allow-origin'), null);
});

test('rate limitはtenantとuserの組をハッシュ化したキーで制限する', async () => {
  let now = 1_000;
  const store = new InMemoryRateLimitStore();
  const app = new Hono();
  app.use(
    '*',
    createRateLimitMiddleware({
      scope: 'members',
      ...rateLimitPolicies.authenticated,
      store,
      now: () => now,
      keyResolver: () => ({
        kind: 'user',
        tenantId: 'tenant-a',
        userId: 'user-a',
      }),
    }),
  );
  app.get('/api/v1/ping', (c) => c.json({ ok: true }));

  for (let index = 0; index < 60; index += 1) {
    const response = await app.request('/api/v1/ping');
    assert.equal(response.status, 200);
  }
  const limited = await app.request('/api/v1/ping');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.match(limited.headers.get('x-ratelimit-remaining') ?? '', /^0$/);

  now += 60_000;
  assert.equal((await app.request('/api/v1/ping')).status, 200);

  const key = createRateLimitKey('members', {
    kind: 'user',
    tenantId: 'tenant-a',
    userId: 'user-a',
  });
  assert.equal(key.includes('tenant-a'), false);
  assert.equal(key.includes('user-a'), false);
});

test('identityがないrate limitはIPだけへフォールバックせず503で停止する', async () => {
  const app = new Hono();
  app.use(
    '*',
    createRateLimitMiddleware({
      scope: 'members',
      limit: 1,
      windowMs: 60_000,
      keyResolver: () => null,
    }),
  );
  app.get('/api/v1/ping', (c) => c.json({ ok: true }));
  assert.equal((await app.request('/api/v1/ping')).status, 503);
});

test('構造化ログは最小契約を満たすJSON一行だけを出力する', () => {
  const lines: string[] = [];
  const logger = createStructuredLogger((line) => lines.push(line));
  assert.equal(
    logger.write({
      timestamp: '2026-08-22T00:00:00.000Z',
      level: 'info',
      event: 'request.completed',
      service: 'api',
      environment: 'local',
      requestId: 'request-1',
      method: 'GET',
      path: '/api/v1/members',
      status: 200,
      durationMs: 4,
    }),
    true,
  );
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0] ?? ''), {
    timestamp: '2026-08-22T00:00:00.000Z',
    level: 'info',
    event: 'request.completed',
    service: 'api',
    environment: 'local',
    requestId: 'request-1',
    method: 'GET',
    path: '/api/v1/members',
    status: 200,
    durationMs: 4,
  });

  assert.equal(
    logger.write({
      timestamp: '2026-08-22T00:00:00.000Z',
      level: 'info',
      event: 'request.completed',
      service: 'api',
      environment: 'local',
      requestId: 'request-2',
      method: 'GET',
      path: '/api/v1/members',
      status: 200,
      durationMs: 4,
      authorization: 'Bearer secret',
    } as never),
    false,
  );
  assert.equal(lines.length, 1);
});

test('request loggerはquery、header、IPを出力しない', async () => {
  const lines: string[] = [];
  let now = 100;
  const app = new Hono();
  app.use(
    '*',
    createRequestLoggerMiddleware({
      logger: createStructuredLogger((line) => lines.push(line)),
      environment: 'local',
      now: () => now++,
      pathResolver: () => '/api/v1/ping',
    }),
  );
  app.get('/api/v1/ping', (c) => c.json({ ok: true }));
  const response = await app.request('/api/v1/ping?name=個人情報', {
    headers: {
      'X-Request-Id': 'request-3',
      Authorization: 'Bearer secret',
    },
  });
  assert.equal(response.status, 200);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.includes('個人情報'), false);
  assert.equal(lines[0]?.includes('secret'), false);
  assert.equal(JSON.parse(lines[0] ?? '').path, '/api/v1/ping');
});

test('公開レスポンス契約違反は元の本文を返さず500に置換する', async () => {
  const app = new Hono();
  app.use(
    '*',
    createResponseContractMiddleware({
      contracts: [
        {
          method: 'GET',
          path: /^\/api\/v1\/members$/,
          status: 200,
          schema: memberListResponseSchema,
        },
      ],
    }),
  );
  app.get('/api/v1/members', (c) =>
    c.json({ data: [{ secret: 'do-not-return' }], page: 1, pageSize: 50 }),
  );
  const response = await app.request('/api/v1/members', {
    headers: { 'X-Request-Id': 'request-4' },
  });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(JSON.stringify(body).includes('do-not-return'), false);
});

test('公開レスポンス契約は正常なUUIDv7の部員一覧を通す', () => {
  const parsed = memberListResponseSchema.safeParse({
    data: [
      {
        id: '00000000-0000-7000-8000-000000000001',
        name: '部員',
        kana: null,
        category: 'student',
        gradeLevel: 5,
        status: 'active',
      },
    ],
    page: 1,
    pageSize: 50,
  });
  assert.equal(parsed.success, true);
});

test('CORSのallowlistはワイルドカードとpath付きoriginをfail-closedで拒否する', () => {
  assert.throws(() => createCorsMiddleware({ origins: ['*'] }));
  assert.throws(() =>
    createCorsMiddleware({ origins: ['https://app.example.com/path'] }),
  );
});

test('rate limitの固定窓はupload sessionを毎分10件に制限する', () => {
  assert.deepEqual(rateLimitPolicies.uploadSession, {
    limit: 10,
    windowMs: 60_000,
  });
});
