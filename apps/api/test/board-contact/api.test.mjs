import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoardContactApp } from '../../dist/features/board-contact/index.js';

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const contacts = [
  {
    id: '00000000-0000-7000-8000-000000000301',
    tenantId: TENANT_A,
    fiscalYear: 2026,
    roleName: '会計',
    roleType: 'admin',
    assigneeUserId: 'user-a',
    lineContact: 'https://line.example/contact-a',
    phone: '090-0000-0000',
    contactPreference: 'both',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  },
];

const memberships = {
  'owner-a': { tenantId: TENANT_A, role: 'owner' },
  'admin-a': { tenantId: TENANT_A, role: 'admin' },
  'staff-a': { tenantId: TENANT_A, role: 'staff' },
  'owner-b': {
    tenantId: '00000000-0000-7000-8000-000000000002',
    role: 'owner',
  },
};

function createTestApp() {
  const calls = [];
  const repository = {
    async list(input) {
      calls.push({ operation: 'list', input });
      return contacts.filter(
        (contact) =>
          contact.tenantId === input.tenantId &&
          (input.fiscalYear == null || contact.fiscalYear === input.fiscalYear),
      );
    },
    async create(input) {
      calls.push({ operation: 'create', input });
      return {
        ...input.contact,
        id: '00000000-0000-7000-8000-000000000302',
        tenantId: input.tenantId,
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
      };
    },
    async update(input) {
      calls.push({ operation: 'update', input });
      return { ...contacts[0], ...input.patch };
    },
    async remove(input) {
      calls.push({ operation: 'remove', input });
      return contacts[0];
    },
    async copyYear(input) {
      calls.push({ operation: 'copyYear', input });
      return [
        {
          ...contacts[0],
          id: '00000000-0000-7000-8000-000000000303',
          fiscalYear: input.toFiscalYear,
          assigneeUserId: null,
          lineContact: null,
          phone: null,
          contactPreference: 'line',
        },
      ];
    },
  };
  return {
    app: createBoardContactApp({
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
      boardContactRepository: repository,
    }),
    calls,
  };
}

async function json(response) {
  return response.json();
}

test('未認証の役員一覧は401で拒否する', async () => {
  const { app } = createTestApp();
  const response = await app.request('/api/v1/board-members?fiscalYear=2026');
  assert.equal(response.status, 401);
  assert.equal((await json(response)).error.code, 'UNAUTHENTICATED');
});

test('期限切れtokenと不正なqueryは処理前に拒否する', async () => {
  const { app } = createTestApp();
  const expiredApp = createBoardContactApp({
    verifyToken: async () => ({
      userId: 'owner-a',
      issuer: 'https://example.supabase.co/auth/v1',
      audience: 'authenticated',
      expiresAt: Math.floor(Date.now() / 1000) - 1,
    }),
    membershipRepository: {
      findActiveByUserId: async () => memberships['owner-a'],
    },
    boardContactRepository: {
      list: async () => [],
      create: async () => contacts[0],
      update: async () => contacts[0],
      remove: async () => contacts[0],
      copyYear: async () => [],
    },
  });
  const expired = await expiredApp.request('/api/v1/board-members', {
    headers: { authorization: 'Bearer expired' },
  });
  assert.equal(expired.status, 401);
  assert.equal((await json(expired)).error.code, 'UNAUTHENTICATED');

  const invalidQuery = await app.request(
    '/api/v1/board-members?tenantId=other',
    {
      headers: { authorization: 'Bearer owner-a' },
    },
  );
  assert.equal(invalidQuery.status, 400);
  assert.equal((await json(invalidQuery)).error.code, 'VALIDATION_ERROR');
});

test('ownerの一覧は設定に応じた連絡先だけを返す', async () => {
  const { app } = createTestApp();
  const response = await app.request('/api/v1/board-members?fiscalYear=2026', {
    headers: { authorization: 'Bearer owner-a' },
  });
  const payload = await json(response);
  assert.equal(response.status, 200);
  assert.equal(payload.data[0].phone, '090-0000-0000');
  assert.equal(payload.data[0].lineContact, 'https://line.example/contact-a');
  assert.equal(payload.data[0].tenantId, undefined);
});

test('staffの一覧は役職枠だけを返し、連絡先PIIを返さない', async () => {
  const { app } = createTestApp();
  const response = await app.request('/api/v1/board-members?fiscalYear=2026', {
    headers: { authorization: 'Bearer staff-a' },
  });
  const payload = await json(response);
  assert.equal(response.status, 200);
  assert.equal(payload.data[0].phone, undefined);
  assert.equal(payload.data[0].lineContact, undefined);
  assert.equal(payload.data[0].assigneeUserId, undefined);
});

test('staffの登録は403、tenantId混入は400で拒否する', async () => {
  const { app } = createTestApp();
  const staffResponse = await app.request('/api/v1/board-members', {
    method: 'POST',
    headers: {
      authorization: 'Bearer staff-a',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      fiscalYear: 2026,
      roleName: '会長',
      roleType: 'admin',
    }),
  });
  assert.equal(staffResponse.status, 403);

  const tenantResponse = await app.request('/api/v1/board-members', {
    method: 'POST',
    headers: {
      authorization: 'Bearer owner-a',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      tenantId: '00000000-0000-7000-8000-000000000002',
      fiscalYear: 2026,
      roleName: '会長',
      roleType: 'admin',
    }),
  });
  assert.equal(tenantResponse.status, 400);
});

test('別テナントのownerはAテナントの役員を取得できず、更新もstaffには許可しない', async () => {
  const { app, calls } = createTestApp();
  const otherTenantResponse = await app.request(
    '/api/v1/board-members?fiscalYear=2026',
    { headers: { authorization: 'Bearer owner-b' } },
  );
  assert.equal(otherTenantResponse.status, 200);
  assert.deepEqual((await json(otherTenantResponse)).data, []);
  assert.equal(calls.at(-1).input.tenantId, memberships['owner-b'].tenantId);

  const staffUpdate = await app.request(
    '/api/v1/board-members/00000000-0000-7000-8000-000000000301',
    {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer staff-a',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ roleName: '会計' }),
    },
  );
  assert.equal(staffUpdate.status, 403);
});

test('ownerの登録と年度引き継ぎはtenantを認証所属から決め、個人情報をコピーしない', async () => {
  const { app, calls } = createTestApp();
  const createResponse = await app.request('/api/v1/board-members', {
    method: 'POST',
    headers: {
      authorization: 'Bearer owner-a',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      fiscalYear: 2027,
      roleName: '会長',
      roleType: 'admin',
      phone: '090-1111-1111',
      contactPreference: 'phone',
    }),
  });
  assert.equal(createResponse.status, 201);
  assert.equal(calls.at(-1).input.tenantId, TENANT_A);
  assert.equal((await json(createResponse)).data.phone, '090-1111-1111');

  const copyResponse = await app.request('/api/v1/board-members/copy-year', {
    method: 'POST',
    headers: {
      authorization: 'Bearer owner-a',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ fromFiscalYear: 2026, toFiscalYear: 2027 }),
  });
  const copyPayload = await json(copyResponse);
  assert.equal(copyResponse.status, 201);
  assert.equal(copyPayload.data[0].phone, undefined);
  assert.equal(copyPayload.data[0].lineContact, undefined);
  assert.equal(calls.at(-1).input.tenantId, TENANT_A);
});
