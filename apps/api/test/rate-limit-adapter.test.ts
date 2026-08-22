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
  bundledRateLimitAdapterPackages,
  type CentralRateLimitStore,
  createConfiguredRateLimitStore,
  createDistributedRateLimitStore,
  type DistributedRateLimitAdapter,
  extractPnpmLockfilePackageNames,
  isHashedRateLimitKey,
  loadDistributedRateLimitAdapter,
  validateRateLimitAdapterModule,
} from '../dist/security/rate-limit-adapter.js';
import { maliciousRateLimitAdapterModules } from './fixtures/rate-limit-adapter-malicious.mjs';

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

test('APP_ENV由来のnamespaceをキーへ含め、stagingとproductionを分離する', () => {
  const identity = {
    kind: 'user' as const,
    tenantId: 'tenant-a',
    userId: 'user-a',
  };
  const stagingKey = createRateLimitKey('staging', 'members', identity);
  const productionKey = createRateLimitKey('production', 'members', identity);

  assert.notEqual(stagingKey, productionKey);
  assert.equal(stagingKey.includes(':staging:'), true);
  assert.equal(isHashedRateLimitKey(stagingKey, 'staging'), true);
  assert.equal(isHashedRateLimitKey(stagingKey, 'production'), false);
});

test('中央RateLimitStore契約へadapterを注入したdistributed storeを生成する', async () => {
  let receivedContext: { signal: AbortSignal; timeoutMs: number } | undefined;
  const adapter: DistributedRateLimitAdapter = {
    consumeAtomic: async (input, context) => {
      receivedContext = context;
      return {
        allowed: true,
        remaining: input.limit - 1,
        resetAtMs: input.nowMs + input.windowMs,
      };
    },
  };
  const store: CentralRateLimitStore = createDistributedRateLimitStore({
    adapter,
    namespace: 'staging',
    timeoutMs: 25,
  });
  const key = createRateLimitKey('staging', 'members', {
    kind: 'user',
    tenantId: 'tenant-a',
    userId: 'user-a',
  });

  const result = await store.consume({
    key,
    limit: 1,
    windowMs: 60_000,
    nowMs: 1_000,
  });
  assert.equal(store.distributed, true);
  assert.strictEqual(store.adapter, adapter);
  assert.equal(store.namespace, 'staging');
  assert.equal(result.allowed, true);
  assert.ok(receivedContext);
  assert.equal(receivedContext.timeoutMs, 25);
  assert.equal(receivedContext.signal.aborted, false);
});

test('分散storeはnamespaceが異なるkeyをadapterへ渡さない', async () => {
  let calls = 0;
  const store = createDistributedRateLimitStore({
    adapter: {
      consumeAtomic: async () => {
        calls += 1;
        return { allowed: true, remaining: 0, resetAtMs: 61_000 };
      },
    },
    namespace: 'production',
  });

  await assert.rejects(
    Promise.resolve(
      store.consume({
        key: createRateLimitKey('staging', 'members', {
          kind: 'user',
          tenantId: 'tenant-a',
          userId: 'user-a',
        }),
        limit: 1,
        windowMs: 60_000,
        nowMs: 1_000,
      }),
    ),
    /分散rate limitの入力契約が不正です。/,
  );
  assert.equal(calls, 0);
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

test('外部storeのconsumeAtomicがtimeoutすると503で業務handlerを呼ばない', async () => {
  let receivedSignal: AbortSignal | undefined;
  let handlerCalls = 0;
  const app = new Hono();
  app.use(
    '*',
    createRateLimitMiddleware({
      scope: 'members',
      limit: 1,
      windowMs: 60_000,
      timeoutMs: 10,
      store: createDistributedRateLimitStore({
        adapter: {
          consumeAtomic: async (_input, context) => {
            receivedSignal = context.signal;
            return new Promise<{
              allowed: boolean;
              remaining: number;
              resetAtMs: number;
            }>(() => undefined);
          },
        },
        namespace: 'local',
      }),
      keyResolver: () => ({
        kind: 'user',
        tenantId: 'tenant-a',
        userId: 'user-a',
      }),
    }),
  );
  app.get('/', () => {
    handlerCalls += 1;
    return new Response('ok');
  });

  const response = await app.request('/');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'RATE_LIMIT_UNAVAILABLE');
  assert.equal(handlerCalls, 0);
  assert.ok(receivedSignal);
  assert.equal(receivedSignal.aborted, true);
});

test('RATE_LIMIT_ADAPTER_MODULEはfile/data/nodeとlockfile外packageを拒否する', async () => {
  for (const moduleSpecifier of maliciousRateLimitAdapterModules)
    assert.throws(
      () =>
        validateRateLimitAdapterModule(moduleSpecifier, {
          allowedPackages: ['@cocolo/test-rate-limit-adapter'],
          lockfilePackages: ['@cocolo/test-rate-limit-adapter'],
        }),
      /Node package名だけを指定してください。/,
    );

  const maliciousGlobal = globalThis as typeof globalThis & {
    __rateLimitCompromised?: boolean;
  };
  delete maliciousGlobal.__rateLimitCompromised;
  await assert.rejects(
    () =>
      loadDistributedRateLimitAdapter(
        new URL(
          './fixtures/rate-limit-adapter-malicious-module.mjs',
          import.meta.url,
        ).href,
      ),
    /Node package名だけを指定してください。/,
  );
  assert.equal(maliciousGlobal.__rateLimitCompromised, undefined);

  assert.throws(
    () =>
      validateRateLimitAdapterModule('@cocolo/not-installed-adapter', {
        allowedPackages: ['@cocolo/not-installed-adapter'],
        lockfilePackages: [],
      }),
    /pnpm lockfileの許可パッケージにありません。/,
  );
  assert.throws(
    () => validateRateLimitAdapterModule('@cocolo/rate-limit-redis-adapter'),
    /adapter package allowlistにありません。/,
  );
  assert.equal(bundledRateLimitAdapterPackages.length, 0);
});

test('pnpm lockfileからpackage root名だけを抽出する', () => {
  assert.deepEqual(
    [
      ...extractPnpmLockfilePackageNames(`
packages:
  '@cocolo/rate-limit-redis-adapter@1.0.0':
  rate-limit-redis-adapter@1.0.0:
`),
    ].sort(),
    ['@cocolo/rate-limit-redis-adapter', 'rate-limit-redis-adapter'],
  );
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
