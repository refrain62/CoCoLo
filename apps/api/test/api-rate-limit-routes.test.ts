import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../dist/app.js';
import {
  createRateLimitKey,
  InMemoryRateLimitStore,
} from '../dist/security/rate-limit.js';

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const MEMBER_ID = '00000000-0000-7000-8000-000000000002';
const TOKEN = 'owner-a';
const EXPECTED_RATE_LIMIT_KEY =
  'user:local:40c041842ccbe556bd30396b6ba8070418afa56119feebd79d2b74a15d176fc8:3141bd6a6db1e7517a8d29683809e31d03ba320df700d5335fef6cb98a4c0bec';

class RecordingRateLimitStore extends InMemoryRateLimitStore {
  readonly keys: string[] = [];
  private readonly allowed: boolean;

  constructor(allowed: boolean) {
    super();
    this.allowed = allowed;
  }

  override consume(input: {
    key: string;
    limit: number;
    windowMs: number;
    nowMs: number;
  }) {
    this.keys.push(input.key);
    return {
      allowed: this.allowed,
      remaining: this.allowed ? input.limit - 1 : 0,
      resetAtMs: input.nowMs + input.windowMs,
    };
  }
}

function createTestApp(store: RecordingRateLimitStore) {
  let producerCalls = 0;
  let verifyTokenCalls = 0;
  const app = createApp({
    verifyToken: async (token) => {
      verifyTokenCalls += 1;
      if (token !== TOKEN) throw new Error('invalid token');
      return {
        userId: TOKEN,
        issuer: 'https://example.supabase.co/auth/v1',
        audience: 'authenticated',
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      };
    },
    membershipRepository: {
      findActiveByUserId: async () => ({ tenantId: TENANT_A, role: 'owner' }),
    },
    memberRepository: {
      list: async () => [],
      create: async () => {
        throw new Error('not used');
      },
      update: async () => null,
      retire: async () => null,
    },
    lineDeliveryProducer: {
      publish: async () => {
        producerCalls += 1;
        return { notificationId: '00000000-0000-7000-8000-000000000101' };
      },
    },
    rateLimit: { localStore: store },
  });
  return {
    app,
    getProducerCalls: () => producerCalls,
    getVerifyTokenCalls: () => verifyTokenCalls,
  };
}

const authHeaders = { authorization: `Bearer ${TOKEN}` };

test('認証済みのexact routeにもtenant/user rate limitを適用する', async () => {
  const store = new RecordingRateLimitStore(true);
  const { app, getProducerCalls, getVerifyTokenCalls } = createTestApp(store);

  const members = await app.request('/api/v1/members', {
    headers: authHeaders,
  });
  const notification = await app.request('/api/v1/notifications/line', {
    method: 'POST',
    headers: {
      ...authHeaders,
      'content-type': 'application/json',
      'idempotency-key': 'notification-001',
    },
    body: JSON.stringify({
      sourceId: 'event-001',
      destination: 'group-001',
      title: '予定のお知らせ',
      body: '練習があります。',
      deepLink: 'https://staging.example.test/events/event-001',
    }),
  });

  assert.equal(members.status, 200);
  assert.equal(notification.status, 202);
  assert.equal(store.keys.length, 2);
  assert.equal(store.keys[0], EXPECTED_RATE_LIMIT_KEY);
  assert.equal(
    store.keys[0],
    createRateLimitKey('local', 'authenticated', {
      kind: 'user',
      tenantId: TENANT_A,
      userId: TOKEN,
    }),
  );
  assert.equal(store.keys[0], store.keys[1]);
  assert.match(store.keys[0], /^user:local:[a-f0-9]{64}:[a-f0-9]{64}$/);
  assert.doesNotMatch(store.keys[0], new RegExp(`${TENANT_A}|${TOKEN}`));
  assert.equal(getVerifyTokenCalls(), 2);
  assert.equal(getProducerCalls(), 1);
});

test('rate limit超過時はexact routeの業務handlerを呼ばず429にする', async () => {
  const store = new RecordingRateLimitStore(false);
  const { app, getProducerCalls } = createTestApp(store);

  const members = await app.request('/api/v1/members', {
    headers: authHeaders,
  });
  const memberCreate = await app.request('/api/v1/members', {
    method: 'POST',
    headers: authHeaders,
  });
  const memberUpdate = await app.request(`/api/v1/members/${MEMBER_ID}`, {
    method: 'PATCH',
    headers: authHeaders,
  });
  const memberRetire = await app.request(
    `/api/v1/members/${MEMBER_ID}/retire`,
    {
      method: 'POST',
      headers: authHeaders,
    },
  );
  const memberPromote = await app.request('/api/v1/members/promote', {
    method: 'POST',
    headers: authHeaders,
  });
  const notification = await app.request('/api/v1/notifications/line', {
    method: 'POST',
    headers: {
      ...authHeaders,
      'content-type': 'application/json',
      'idempotency-key': 'notification-002',
      'x-request-id': 'rate-limit-request-002',
    },
    body: JSON.stringify({
      sourceId: 'event-002',
      destination: 'group-001',
      title: '予定のお知らせ',
      body: '練習があります。',
      deepLink: 'https://staging.example.test/events/event-002',
    }),
  });

  assert.deepEqual(
    [
      members.status,
      memberCreate.status,
      memberUpdate.status,
      memberRetire.status,
      memberPromote.status,
    ],
    [429, 429, 429, 429, 429],
  );
  assert.equal(notification.status, 429);
  assert.equal(
    notification.headers.get('x-request-id'),
    'rate-limit-request-002',
  );
  assert.equal(notification.headers.get('x-ratelimit-limit'), '60');
  assert.equal(notification.headers.get('x-ratelimit-remaining'), '0');
  assert.equal(notification.headers.get('retry-after'), '60');
  assert.deepEqual(await notification.json(), {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'リクエスト数の上限を超えました。',
      details: {},
      requestId: 'rate-limit-request-002',
    },
  });
  assert.equal(getProducerCalls(), 0);
});
