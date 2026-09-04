import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../dist/app.js';
import type { MemberRecord, MembershipContext } from '../src/app.js';
import { createFeatureContractFeatures } from './feature-contract-fixture.ts';

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const TENANT_B = '00000000-0000-7000-8000-000000000002';
const MEMBER_A = '00000000-0000-7000-8000-000000000101';

const memberships: Record<string, MembershipContext> = {
  'owner-a': { tenantId: TENANT_A, role: 'owner' },
  'staff-a': { tenantId: TENANT_A, role: 'staff' },
  'guardian-a': { tenantId: TENANT_A, role: 'guardian' },
  'owner-b': { tenantId: TENANT_B, role: 'owner' },
};

const members: MemberRecord[] = [
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

type MembersPayload<T = Array<Record<string, unknown>>> = {
  data: T;
  error?: { code: string; requestId?: string };
};

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
        id: '00000000-0000-7000-8000-000000000102',
        tenantId,
        name: input.name,
        kana: input.kana ?? null,
        category: input.category,
        gradeLevel: input.gradeLevel ?? null,
        ageGroup: input.ageGroup ?? null,
        status: input.status,
        createdAt: '2026-08-22T00:00:00.000Z',
        actorUserId,
      }),
      update: async ({ tenantId, memberId, member: input }) => ({
        id: memberId,
        tenantId,
        name: input.name,
        kana: input.kana ?? null,
        category: input.category,
        gradeLevel: input.gradeLevel ?? null,
        ageGroup: input.ageGroup ?? null,
        status: input.status,
        createdAt: members[0]?.createdAt ?? '2026-08-22T00:00:00.000Z',
      }),
      retire: async ({ tenantId, memberId }) => ({
        id: memberId,
        tenantId,
        name: members[0]?.name ?? 'テスト部員',
        kana: members[0]?.kana ?? null,
        category: members[0]?.category ?? 'student',
        gradeLevel: members[0]?.gradeLevel ?? null,
        ageGroup: members[0]?.ageGroup ?? null,
        status: 'retired',
        createdAt: members[0]?.createdAt ?? '2026-08-22T00:00:00.000Z',
      }),
    },
    centralFeatures: createFeatureContractFeatures(),
  });
}

async function readJson<T = Array<Record<string, unknown>>>(
  response: Response,
): Promise<MembersPayload<T>> {
  return (await response.json()) as MembersPayload<T>;
}

function assertError(payload: MembersPayload, code: string) {
  assert.ok(payload.error);
  assert.equal(payload.error.code, code);
  assert.ok(payload.error.requestId);
}

test('未認証の部員一覧は401で拒否する', async () => {
  const response = await createTestApp().request('/api/v1/members');

  assert.equal(response.status, 401);
  assertError(await readJson(response), 'UNAUTHENTICATED');
});

test('JWT の所属テナントを無視した tenantId の指定は400で拒否する', async () => {
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

test('staff 権限による部員登録は403で拒否する', async () => {
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

test('学生に年代を指定した登録は400で拒否する', async () => {
  const response = await createTestApp().request('/api/v1/members', {
    method: 'POST',
    headers: {
      authorization: 'Bearer owner-a',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: '区分不整合',
      category: 'student',
      gradeLevel: 1,
      ageGroup: '30代',
    }),
  });

  assert.equal(response.status, 400);
  assertError(await readJson(response), 'VALIDATION_ERROR');
});

test('一般に学年を指定した登録は400で拒否する', async () => {
  const response = await createTestApp().request('/api/v1/members', {
    method: 'POST',
    headers: {
      authorization: 'Bearer owner-a',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: '区分不整合',
      category: 'adult',
      gradeLevel: 1,
      ageGroup: '30代',
    }),
  });

  assert.equal(response.status, 400);
  assertError(await readJson(response), 'VALIDATION_ERROR');
});

test('owner の一覧は所属情報で解決したテナント内だけを返す', async () => {
  const response = await createTestApp().request('/api/v1/members', {
    headers: { authorization: 'Bearer owner-a' },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(payload.data.length, 1);
  const member = payload.data[0];
  assert.ok(member);
  assert.equal(member.tenantId, undefined);
  assert.equal(member.id, MEMBER_A);
});

test('guardian の一覧は担当部員の最小項目だけを返す', async () => {
  const response = await createTestApp().request('/api/v1/members', {
    headers: { authorization: 'Bearer guardian-a' },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  const member = payload.data[0];
  assert.ok(member);
  assert.deepEqual(Object.keys(member).sort(), [
    'category',
    'gradeLevel',
    'id',
    'kana',
    'name',
    'status',
  ]);
});

test('owner の登録は所属情報のテナントで作成し、note を永続化しない', async () => {
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
  const payload = await readJson<Record<string, unknown>>(response);

  assert.equal(response.status, 201);
  assert.equal(payload.data.tenantId, undefined);
  assert.equal(payload.data.name, '新規部員');
  assert.equal(payload.data.note, undefined);
});

test('staff 権限による部員編集と退部は403で拒否する', async () => {
  const updateResponse = await createTestApp().request(
    `/api/v1/members/${MEMBER_A}`,
    {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer staff-a',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '編集不可',
        category: 'student',
        gradeLevel: 10,
        status: 'active',
      }),
    },
  );
  const retireResponse = await createTestApp().request(
    `/api/v1/members/${MEMBER_A}/retire`,
    { method: 'POST', headers: { authorization: 'Bearer staff-a' } },
  );

  assert.equal(updateResponse.status, 403);
  assertError(await readJson(updateResponse), 'FORBIDDEN');
  assert.equal(retireResponse.status, 403);
  assertError(await readJson(retireResponse), 'FORBIDDEN');
});

test('owner の編集は認証コンテキストのテナントで実行する', async () => {
  const response = await createTestApp().request(
    `/api/v1/members/${MEMBER_A}`,
    {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer owner-a',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '更新後の部員',
        kana: 'こうしんごのぶいん',
        category: 'student',
        gradeLevel: 10,
        ageGroup: null,
        status: 'suspended',
      }),
    },
  );
  const payload = await readJson<Record<string, unknown>>(response);

  assert.equal(response.status, 200);
  assert.equal(payload.data.name, '更新後の部員');
  assert.equal(payload.data.status, 'suspended');
  assert.equal(payload.data.tenantId, undefined);
});

test('不正な部員IDと退部入力は400で拒否する', async () => {
  const invalidIdResponse = await createTestApp().request(
    '/api/v1/members/not-a-uuid/retire',
    { method: 'POST', headers: { authorization: 'Bearer owner-a' } },
  );
  const invalidBodyResponse = await createTestApp().request(
    `/api/v1/members/${MEMBER_A}`,
    {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer owner-a',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '区分不整合',
        category: 'adult',
        gradeLevel: 1,
        status: 'active',
      }),
    },
  );

  assert.equal(invalidIdResponse.status, 400);
  assertError(await readJson(invalidIdResponse), 'VALIDATION_ERROR');
  assert.equal(invalidBodyResponse.status, 400);
  assertError(await readJson(invalidBodyResponse), 'VALIDATION_ERROR');
});

test('owner の退部操作は退部結果を返す', async () => {
  const response = await createTestApp().request(
    `/api/v1/members/${MEMBER_A}/retire`,
    { method: 'POST', headers: { authorization: 'Bearer owner-a' } },
  );
  const payload = await readJson<Record<string, unknown>>(response);

  assert.equal(response.status, 200);
  assert.equal(payload.data.status, 'retired');
});

test('リポジトリの予期しない失敗は requestId 付きの500へ収束する', async () => {
  const app = createApp({
    verifyToken: async () => ({
      userId: 'owner-a',
      issuer: 'https://example.supabase.co/auth/v1',
      audience: 'authenticated',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    }),
    membershipRepository: {
      findActiveByUserId: async () => ({ tenantId: TENANT_A, role: 'owner' }),
    },
    memberRepository: {
      list: async () => [],
      create: async () => {
        throw new Error('database failure');
      },
      update: async () => null,
      retire: async () => null,
    },
    centralFeatures: createFeatureContractFeatures(),
  });
  const response = await app.request('/api/v1/members', {
    method: 'POST',
    headers: {
      authorization: 'Bearer owner-a',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: 'DB失敗',
      category: 'student',
      gradeLevel: 1,
    }),
  });

  assert.equal(response.status, 500);
  assertError(await readJson(response), 'INTERNAL_SERVER_ERROR');
});
