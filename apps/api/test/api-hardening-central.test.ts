import assert from 'node:assert/strict';
import test from 'node:test';
import type { MemberRole } from '@cocolo/contracts/member';
import type { MemberRecord } from '../dist/app.js';
import { createApp } from '../dist/app.js';
import { createStructuredLogger } from '../dist/security/structured-logger.js';

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const MEMBER_A = '00000000-0000-7000-8000-000000000002';
const TOKEN = 'owner-a';
const REQUEST_ID_1 = '00000000-0000-4000-8000-000000000011';
const REQUEST_ID_2 = '00000000-0000-4000-8000-000000000012';
const REQUEST_ID_3 = '00000000-0000-4000-8000-000000000013';
const REQUEST_ID_4 = '00000000-0000-4000-8000-000000000014';

function createMemberApp(
  member: MemberRecord,
  logs: string[] = [],
  role: MemberRole = 'owner',
  membershipError = false,
) {
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
      findActiveByUserId: async () => {
        if (membershipError) throw new Error('membership store unavailable');
        return { tenantId: TENANT_A, role };
      },
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
      'x-request-id': REQUEST_ID_1,
    },
  });

  assert.equal(response.status, 200);
  assert.equal(logs.length, 1);
  const entry = JSON.parse(logs[0] ?? '') as Record<string, unknown>;
  assert.equal(entry.requestId, REQUEST_ID_1);
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
  const logs: string[] = [];
  const app = createMemberApp(
    {
      ...validMember,
      id: 'not-a-uuid',
    },
    logs,
  );
  const response = await app.request('/api/v1/members', {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'x-request-id': REQUEST_ID_2,
    },
  });

  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(body.error.requestId, REQUEST_ID_2);
  assert.equal(JSON.stringify(body).includes('not-a-uuid'), false);
  assert.equal(logs.length, 1);
  assert.equal(
    JSON.parse(logs[0] ?? '').errorCode,
    'RESPONSE_CONTRACT_VIOLATION',
  );
});

test('中央APIの未登録成功routeは404ではなく内部エラーへ収束する', async () => {
  const app = createMemberApp(validMember);
  app.get('/api/v1/unregistered', (c) => c.json({ secret: 'do-not-return' }));

  const response = await app.request('/api/v1/unregistered', {
    headers: { 'x-request-id': REQUEST_ID_3 },
  });

  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(JSON.stringify(body).includes('do-not-return'), false);
});

test('中央APIの未知routeは共通404契約とrequestIdを返す', async () => {
  const app = createMemberApp(validMember);
  const response = await app.request('/api/v1/unknown', {
    headers: { 'x-request-id': REQUEST_ID_4 },
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'NOT_FOUND',
      message: '指定されたAPIが見つかりません。',
      details: {},
      requestId: REQUEST_ID_4,
    },
  });
});

test('中央APIの非JSON成功レスポンスは契約未登録として500に収束する', async () => {
  const app = createMemberApp(validMember);
  app.get('/api/v1/plain', (c) => c.text('secret-response'));

  const response = await app.request('/api/v1/plain');

  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(JSON.stringify(body).includes('secret-response'), false);
});

test('CORSのAPI preflightに限って204を非JSON契約のallowlistへ通す', async () => {
  const app = createMemberApp(validMember, [], 'owner');
  app.options('/api/v1/plain', (c) => c.body(null, 204));

  const response = await app.request('/api/v1/plain', { method: 'OPTIONS' });

  assert.equal(response.status, 204);
});

test('requestIdを再生成せずレスポンスとログで同じ相関値を使う', async () => {
  const logs: string[] = [];
  const app = createMemberApp(validMember, logs);
  const response = await app.request('/api/v1/unknown', {
    headers: { 'x-request-id': 'x'.repeat(129) },
  });

  assert.equal(response.status, 404);
  const body = await response.json();
  const entry = JSON.parse(logs.at(-1) ?? '') as Record<string, unknown>;
  assert.equal(response.headers.get('x-request-id'), body.error.requestId);
  assert.equal(entry.requestId, body.error.requestId);
});

test('pathResolver未指定でもstructured loggerはqueryなしの実pathを記録する', async () => {
  const logs: string[] = [];
  const app = createApp({
    observability: {
      logger: createStructuredLogger((line) => logs.push(line)),
    },
  });

  const response = await app.request('/health?secret=do-not-log');

  assert.equal(response.status, 200);
  const entry = JSON.parse(logs[0] ?? '') as Record<string, unknown>;
  assert.equal(entry.path, '/health');
  assert.equal(logs[0]?.includes('do-not-log'), false);
});

test('所属解決の依存障害は401ではなく503とdependency.failureに収束する', async () => {
  const logs: string[] = [];
  const app = createMemberApp(validMember, logs, 'owner', true);

  const response = await app.request('/api/v1/members', {
    headers: { authorization: `Bearer ${TOKEN}` },
  });

  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.code, 'DEPENDENCY_UNAVAILABLE');
  assert.equal(JSON.parse(logs[0] ?? '').event, 'dependency.failure');
});

test('未知roleは管理者向けprojectionへfail-openしない', async () => {
  const app = createMemberApp(validMember, [], 'unknown' as MemberRole);

  const response = await app.request('/api/v1/members', {
    headers: { authorization: `Bearer ${TOKEN}` },
  });

  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, 'INTERNAL_SERVER_ERROR');
});
