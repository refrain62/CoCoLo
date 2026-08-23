import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { createApp } from '../dist/app.js';
import { createCorsMiddleware } from '../dist/security/cors.js';

const ALLOWED_ORIGIN = 'https://staging.example.test';

function createTestCorsApp() {
  const app = new Hono();
  app.use(
    '*',
    createCorsMiddleware({
      origins: [ALLOWED_ORIGIN],
      maxAgeSeconds: 300,
    }),
  );
  app.get('/resource', (c) => c.json({ ok: true }));
  return app;
}

test('許可されたoriginのpreflightだけを204で返す', async () => {
  const response = await createTestCorsApp().request('/resource', {
    method: 'OPTIONS',
    headers: {
      Origin: ALLOWED_ORIGIN,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Authorization, Content-Type',
    },
  });

  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get('Access-Control-Allow-Origin'),
    ALLOWED_ORIGIN,
  );
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
  assert.equal(response.headers.get('Access-Control-Max-Age'), '300');
  assert.equal(response.headers.get('Vary'), 'Origin');
  assert.match(
    response.headers.get('Access-Control-Allow-Headers') ?? '',
    /Authorization/i,
  );
});

test('許可されていないorigin、method、headerをfail-closedで拒否する', async () => {
  const app = createTestCorsApp();

  const originResponse = await app.request('/resource', {
    headers: { Origin: 'https://attacker.example.test' },
  });
  assert.equal(originResponse.status, 403);
  assert.equal((await originResponse.json()).error.code, 'CORS_ORIGIN_DENIED');
  assert.ok(originResponse.headers.get('x-request-id'));

  const methodResponse = await app.request('/resource', {
    method: 'OPTIONS',
    headers: {
      Origin: ALLOWED_ORIGIN,
      'Access-Control-Request-Method': 'TRACE',
    },
  });
  assert.equal(methodResponse.status, 403);
  assert.equal((await methodResponse.json()).error.code, 'CORS_METHOD_DENIED');

  const headerResponse = await app.request('/resource', {
    method: 'OPTIONS',
    headers: {
      Origin: ALLOWED_ORIGIN,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'X-Internal-Secret',
    },
  });
  assert.equal(headerResponse.status, 403);
  assert.equal((await headerResponse.json()).error.code, 'CORS_HEADER_DENIED');
});

test('許可された単純リクエストだけにCORS response headerを付ける', async () => {
  const app = createTestCorsApp();
  const allowed = await app.request('/resource', {
    headers: { Origin: ALLOWED_ORIGIN },
  });
  assert.equal(allowed.status, 200);
  assert.equal(
    allowed.headers.get('Access-Control-Allow-Origin'),
    ALLOWED_ORIGIN,
  );
  assert.equal(
    allowed.headers.get('Access-Control-Expose-Headers'),
    'X-Request-Id, ETag, Retry-After',
  );

  const sameOrigin = await app.request('/resource');
  assert.equal(sameOrigin.status, 200);
  assert.equal(sameOrigin.headers.get('Access-Control-Allow-Origin'), null);
});

test('createAppへ接続したCORS境界は認証より前にpreflightを処理する', async () => {
  const app = createApp({ cors: { origins: [ALLOWED_ORIGIN] } });
  const response = await app.request('/api/v1/members', {
    method: 'OPTIONS',
    headers: {
      Origin: ALLOWED_ORIGIN,
      'Access-Control-Request-Method': 'GET',
    },
  });

  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get('Access-Control-Allow-Origin'),
    ALLOWED_ORIGIN,
  );
});

test('CORSのallowlistへwildcardや任意headerを設定できない', () => {
  assert.throws(
    () => createCorsMiddleware({ origins: ['*'] }),
    /CORS origin allowlistに不正な値があります。/,
  );
  assert.throws(
    () => createCorsMiddleware({ origins: [ALLOWED_ORIGIN], methods: ['*'] }),
    /CORS許可メソッドが不正です。/,
  );
  assert.throws(
    () =>
      createCorsMiddleware({
        origins: [ALLOWED_ORIGIN],
        headers: ['X-Internal-Secret'],
      }),
    /CORS許可ヘッダーが不正です。/,
  );
});
