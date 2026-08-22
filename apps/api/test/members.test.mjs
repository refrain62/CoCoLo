import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../dist/app.js';

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const TENANT_B = '00000000-0000-7000-8000-000000000002';
const MEMBER_A = '00000000-0000-7000-8000-000000000101';

const memberships = {
  'owner-a': { tenantId: TENANT_A, role: 'owner' },
  'staff-a': { tenantId: TENANT_A, role: 'staff' },
  'guardian-a': { tenantId: TENANT_A, role: 'guardian' },
  'owner-b': { tenantId: TENANT_B, role: 'owner' },
};

const members = [
  {
    id: MEMBER_A,
    tenantId: TENANT_A,
    name: '山田 太郎',
    kana: 'やまだ たろう',
    category: 'student',
    gradeLevel: 9,
    ageGroup: null,
    status: 'active',
    createdAt: '2026-08-22T00:00:00.000Z',
  },
];

function createTestApp() {
  return createApp({
    verifyToken: async (token) => {
      if (!memberships[token]) throw new Error('invalid token');
      return {
        userId: token,
        issuer: 'https://example.supabase.co/auth/v1',
        audience: 'authenticated',
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      };
    },
    membershipRepository: {
      findActiveByUserId: async (userId) => memberships[userId] ?? null,
    },
    memberRepository: {
      list: async ({ tenantId, role, userId }) =>
        members.filter(
          (member) =>
            member.tenantId === tenantId &&
            (role !== 'guardian' || userId === 'guardian-a'),
        ),
      create: async ({ tenantId, actorUserId }, input) => ({
        ...input,
        id: '00000000-0000-7000-8000-000000000102',
        tenantId,
        createdAt: '2026-08-22T00:00:00.000Z',
        actorUserId,
      }),
    },
  });
}

async function readJson(response) {
  return response.json();
}

function assertError(payload, code) {
  assert.equal(payload.error.code, code);
  assert.ok(payload.error.requestId);
}

test('未認証の部員一覧は401で拒否する', async () => {
  const response = await createTestApp().request('/api/v1/members');

  assert.equal(response.status, 401);
  assertError(await readJson(response), 'UNAUTHENTICATED');
});

test('JWTの所属テナントを無視したtenantId指定は400で拒否する', async () => {
  const response = await createTestApp().request('/api/v1/members', {
    method: 'POST',
    headers: {
      authorization: 'Bearer owner-a',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      tenantId: TENANT_B,
      name: '越境 太郎',
      category: 'student',
      gradeLevel: 1,
    }),
  });

  assert.equal(response.status, 400);
  assertError(await readJson(response), 'VALIDATION_ERROR');
});

test('staffによる部員登録は403で拒否する', async () => {
  const response = await createTestApp().request('/api/v1/members', {
    method: 'POST',
    headers: {
      authorization: 'Bearer staff-a',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: 'スタッフ登録',
      category: 'student',
      gradeLevel: 1,
    }),
  });

  assert.equal(response.status, 403);
  assertError(await readJson(response), 'FORBIDDEN');
});

test('不正な学年と特記事項を含む登録は400で拒否する', async () => {
  const response = await createTestApp().request('/api/v1/members', {
    method: 'POST',
    headers: {
      authorization: 'Bearer owner-a',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: '不正入力',
      category: 'student',
      gradeLevel: 0,
      note: 'Phase 1では受け付けない',
    }),
  });

  assert.equal(response.status, 400);
  assertError(await readJson(response), 'VALIDATION_ERROR');
});

test('ownerの一覧はmembershipで解決したtenant内だけを返す', async () => {
  const response = await createTestApp().request('/api/v1/members', {
    headers: { authorization: 'Bearer owner-a' },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(payload.data.length, 1);
  assert.equal(payload.data[0].tenantId, undefined);
  assert.equal(payload.data[0].id, MEMBER_A);
});

test('guardianの一覧は担当部員の最小項目だけを返す', async () => {
  const response = await createTestApp().request('/api/v1/members', {
    headers: { authorization: 'Bearer guardian-a' },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(payload.data[0]).sort(), [
    'category',
    'gradeLevel',
    'id',
    'kana',
    'name',
    'status',
  ]);
});

test('ownerの登録はmembershipのtenantで作成し、noteを永続化しない', async () => {
  const response = await createTestApp().request('/api/v1/members', {
    method: 'POST',
    headers: {
      authorization: 'Bearer owner-a',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: '新規部員',
      kana: 'しんきぶいん',
      category: 'adult',
      ageGroup: '30代',
      status: 'active',
    }),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 201);
  assert.equal(payload.data.tenantId, undefined);
  assert.equal(payload.data.name, '新規部員');
  assert.equal(payload.data.note, undefined);
});
