import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { createApp } from '../dist/app.js';
import {
  createRateLimitKey,
  createRateLimitMiddleware,
  InMemoryRateLimitStore,
} from '../dist/security/rate-limit.js';
import {
  createConfiguredRateLimitStore,
  createDistributedRateLimitStore,
  type DistributedRateLimitAdapter,
  isHashedRateLimitKey,
} from '../dist/security/rate-limit-adapter.js';

test('tenant/user identityはハッシュ済みキーだけになり外部adapterへPIIを渡さない', async () => {
  const calls: string[] = [];
  const adapter: DistributedRateLimitAdapter = {
    consumeAtomic: async (input) => {
      calls.push(input.key);
      return {
        allowed: true,
        remaining: input.limit - 1,
        resetAtMs: input.nowMs + input.windowMs,
      };
    },
  };
  const app = new Hono();
  app.use(
    '*',
    createRateLimitMiddleware({
      scope: 'members',
      limit: 1,
      windowMs: 60_000,
      store: createDistributedRateLimitStore(adapter),
      keyResolver: () => ({
        kind: 'user',
        tenantId: 'tenant-a-private',
        userId: 'user-a-private',
      }),
    }),
  );
  app.get('/', (c) => c.json({ ok: true }));

  assert.equal((await app.request('/')).status, 200);
  assert.equal(calls.length, 1);
  const key = calls[0];
  assert.ok(key);
  assert.equal(isHashedRateLimitKey(key), true);
  assert.equal(key.includes('tenant-a-private'), false);
  assert.equal(key.includes('user-a-private'), false);
  assert.equal(
    key,
    createRateLimitKey('members', {
      kind: 'user',
      tenantId: 'tenant-a-private',
      userId: 'user-a-private',
    }),
  );
});

test('tenant/userの区切り文字によるキー衝突を許さない', () => {
  const first = createRateLimitKey('members', {
    kind: 'user',
    tenantId: 'tenant:a',
    userId: 'user',
  });
  const second = createRateLimitKey('members', {
    kind: 'user',
    tenantId: 'tenant',
    userId: 'a:user',
  });

  assert.notEqual(first, second);
});

test('空のtenant/user identityをキーへ変換しない', () => {
  assert.throws(
    () =>
      createRateLimitKey('members', {
        kind: 'user',
        tenantId: '',
        userId: 'user-a',
      }),
    /rate limit identityが不正です。/,
  );
});

test('adapter wrapperは未ハッシュキーを外部adapterへ渡さない', async () => {
  let calls = 0;
  const store = createDistributedRateLimitStore({
    consumeAtomic: async () => {
      calls += 1;
      return { allowed: true, remaining: 0, resetAtMs: 61_000 };
    },
  });

  await assert.rejects(async () => {
    await store.consume({
      key: 'user:tenant-a:user-a',
      limit: 1,
      windowMs: 60_000,
      nowMs: 1_000,
    });
  }, /分散rate limitの入力契約が不正です。/);
  assert.equal(calls, 0);
});

test('distributed adapterは同一キーの原子的なconsume結果をrate-limitへ返す', async () => {
  const counts = new Map<string, number>();
  const calls: string[] = [];
  const adapter: DistributedRateLimitAdapter = {
    consumeAtomic: async (input) => {
      calls.push(input.key);
      const count = (counts.get(input.key) ?? 0) + 1;
      counts.set(input.key, count);
      return {
        allowed: count <= input.limit,
        remaining: Math.max(0, input.limit - count),
        resetAtMs: input.nowMs + input.windowMs,
      };
    },
  };
  const app = new Hono();
  app.use(
    '*',
    createRateLimitMiddleware({
      scope: 'members',
      limit: 2,
      windowMs: 60_000,
      store: createDistributedRateLimitStore(adapter),
      keyResolver: () => ({
        kind: 'user',
        tenantId: 'tenant-a',
        userId: 'user-a',
      }),
    }),
  );
  app.get('/', (c) => c.json({ ok: true }));

  const responses = await Promise.all(
    Array.from({ length: 4 }, () => app.request('/')),
  );
  assert.deepEqual(
    responses.map((response) => response.status).sort((a, b) => a - b),
    [200, 200, 429, 429],
  );
  assert.equal(new Set(calls).size, 1);
  assert.equal(calls.length, 4);
});

test('distributed adapter障害はfail-closedで503になる', async () => {
  const app = new Hono();
  app.use(
    '*',
    createRateLimitMiddleware({
      scope: 'members',
      limit: 1,
      windowMs: 60_000,
      store: createDistributedRateLimitStore({
        consumeAtomic: async () => {
          throw new Error('redis unavailable');
        },
      }),
      keyResolver: () => ({
        kind: 'user',
        tenantId: 'tenant-a',
        userId: 'user-a',
      }),
    }),
  );
  app.get('/', (c) => c.json({ ok: true }));

  const response = await app.request('/');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'RATE_LIMIT_UNAVAILABLE');
});

test('環境ごとのstore選択はlocal=in-memory、staging/production=distributedを強制する', () => {
  assert.ok(
    createConfiguredRateLimitStore({
      appEnv: 'local',
      mode: 'memory',
    }) instanceof InMemoryRateLimitStore,
  );
  assert.throws(
    () =>
      createConfiguredRateLimitStore({
        appEnv: 'staging',
        mode: 'memory',
      }),
    /staging\/production環境では分散rate limit storeが必要です。/,
  );
  assert.throws(
    () =>
      createConfiguredRateLimitStore({
        appEnv: 'production',
        mode: 'distributed',
      }),
    /staging\/production環境の分散rate limit adapterが未設定です。/,
  );
  assert.throws(
    () =>
      createConfiguredRateLimitStore({
        appEnv: 'local',
        mode: 'distributed',
        distributedAdapter: {
          consumeAtomic: async () => ({
            allowed: true,
            remaining: 0,
            resetAtMs: 1,
          }),
        },
      }),
    /local環境のrate limit storeはin-memoryだけを指定してください。/,
  );
});

test('production相当のAPIは分散adapterなしで構築できない', () => {
  assert.throws(
    () =>
      createApp({
        rateLimit: { environment: 'production', mode: 'distributed' },
      }),
    /staging\/production環境の分散rate limit adapterが未設定です。/,
  );
});

test('認証済みAPIは分散adapterを通してから業務handlerへ進む', async () => {
  const calls: string[] = [];
  const app = createApp({
    verifyToken: async () => ({
      userId: 'user-a-private',
      issuer: 'https://staging.example.supabase.co/auth/v1',
      audience: 'authenticated',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    }),
    membershipRepository: {
      findActiveByUserId: async () => ({
        tenantId: 'tenant-a-private',
        role: 'owner',
      }),
    },
    rateLimit: {
      environment: 'staging',
      mode: 'distributed',
      distributedAdapter: {
        consumeAtomic: async (input) => {
          calls.push(input.key);
          return {
            allowed: true,
            remaining: input.limit - 1,
            resetAtMs: input.nowMs + input.windowMs,
          };
        },
      },
    },
  });

  const response = await app.request('/api/v1/members', {
    headers: { authorization: 'Bearer test-token' },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'DEPENDENCY_UNAVAILABLE');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.includes('tenant-a-private'), false);
  assert.equal(calls[0]?.includes('user-a-private'), false);
});
