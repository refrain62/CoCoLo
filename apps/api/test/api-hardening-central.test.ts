import assert from 'node:assert/strict';
import test from 'node:test';
import type { MemberRecord } from '../dist/app.js';
import { createApp } from '../dist/app.js';
import { createStructuredLogger } from '../dist/security/structured-logger.js';

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const MEMBER_A = '00000000-0000-7000-8000-000000000002';
const TOKEN = 'owner-a';

function createMemberApp(member: MemberRecord, logs: string[] = []) {
  return createApp({
    verifyToken: async (token) => {
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
      list: async () => [member],
      create: async () => member,
      update: async () => member,
      retire: async () => member,
    },
    observability: {
      logger: createStructuredLogger((line) => logs.push(line)),
      pathResolver: () => '/api/v1/members',
    },
  });
}

const validMember: MemberRecord = {
  id: MEMBER_A,
  tenantId: TENANT_A,
  name: '部員',
  kana: null,
  category: 'student',
  gradeLevel: 5,
  ageGroup: null,
  status: 'active',
  createdAt: '2026-08-23T00:00:00.000Z',
};

test('中央APIの構造化request loggerはqueryと秘密情報を出力しない', async () => {
  const logs: string[] = [];
  const app = createMemberApp(validMember, logs);

  const response = await app.request('/health?name=個人情報', {
    headers: {
      authorization: 'Bearer secret-token',
      'x-request-id': 'central-request-001',
    },
  });

  assert.equal(response.status, 200);
  assert.equal(logs.length, 1);
  const entry = JSON.parse(logs[0] ?? '') as Record<string, unknown>;
  assert.equal(entry.requestId, 'central-request-001');
  assert.equal(entry.path, '/api/v1/members');
  assert.equal(entry.status, 200);
  assert.equal(logs[0]?.includes('個人情報'), false);
  assert.equal(logs[0]?.includes('secret-token'), false);
});

test('中央APIの正常な部員一覧はruntime response契約を通る', async () => {
  const app = createMemberApp(validMember);
  const response = await app.request('/api/v1/members', {
    headers: { authorization: `Bearer ${TOKEN}` },
  });

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, [
    {
      id: MEMBER_A,
      name: '部員',
      kana: null,
      category: 'student',
      gradeLevel: 5,
      status: 'active',
      ageGroup: null,
      createdAt: '2026-08-23T00:00:00.000Z',
    },
  ]);
});

test('中央APIの不正な公開レスポンスは元の本文を返さず500に収束する', async () => {
  const app = createMemberApp({
    ...validMember,
    id: 'not-a-uuid',
  });
  const response = await app.request('/api/v1/members', {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'x-request-id': 'central-request-002',
    },
  });

  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(body.error.requestId, 'central-request-002');
  assert.equal(JSON.stringify(body).includes('not-a-uuid'), false);
});

test('中央APIの未登録成功routeは404ではなく内部エラーへ収束する', async () => {
  const app = createMemberApp(validMember);
  app.get('/api/v1/unregistered', (c) => c.json({ secret: 'do-not-return' }));

  const response = await app.request('/api/v1/unregistered', {
    headers: { 'x-request-id': 'central-request-003' },
  });

  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(JSON.stringify(body).includes('do-not-return'), false);
});

test('中央APIの未知routeは共通404契約とrequestIdを返す', async () => {
  const app = createMemberApp(validMember);
  const response = await app.request('/api/v1/unknown', {
    headers: { 'x-request-id': 'central-request-004' },
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'NOT_FOUND',
      message: '指定されたAPIが見つかりません。',
      details: {},
      requestId: 'central-request-004',
    },
  });
});
