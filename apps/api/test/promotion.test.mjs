import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../dist/app.js';

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const memberships = {
  'owner-a': { tenantId: TENANT_A, role: 'owner' },
  'staff-a': { tenantId: TENANT_A, role: 'staff' },
};

function createTestApp(calls = []) {
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
    promotionRepository: {
      run: async (input) => {
        calls.push(input);
        return {
          mode: input.mode,
          fiscalYear: input.fiscalYear,
          status: input.mode === 'preview' ? 'preview' : 'completed',
          previewCount: input.mode === 'preview' ? 2 : 0,
          promotedCount: input.mode === 'execute' ? 2 : 0,
          result: input.mode === 'execute' ? { promotedMemberIds: [] } : null,
        };
      },
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

test('ownerは年度繰り上げpreviewで対象件数を確認できる', async () => {
  const calls = [];
  const response = await createTestApp(calls).request(
    '/api/v1/members/promote',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer owner-a',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ mode: 'preview', fiscalYear: 2026 }),
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual((await readJson(response)).data, {
    mode: 'preview',
    fiscalYear: 2026,
    status: 'preview',
    previewCount: 2,
    promotedCount: 0,
    result: null,
  });
  assert.deepEqual(calls[0], {
    tenantId: TENANT_A,
    actorUserId: 'owner-a',
    role: 'owner',
    mode: 'preview',
    fiscalYear: 2026,
    idempotencyKey: null,
  });
});

test('年度繰り上げexecuteはIdempotency-Keyなしを拒否する', async () => {
  const response = await createTestApp().request('/api/v1/members/promote', {
    method: 'POST',
    headers: {
      authorization: 'Bearer owner-a',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ mode: 'execute', fiscalYear: 2026 }),
  });

  assert.equal(response.status, 400);
  assertError(await readJson(response), 'VALIDATION_ERROR');
});

test('staffは年度繰り上げを実行できない', async () => {
  const calls = [];
  const response = await createTestApp(calls).request(
    '/api/v1/members/promote',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer staff-a',
        'content-type': 'application/json',
        'idempotency-key': 'promotion-2026-a',
      },
      body: JSON.stringify({ mode: 'execute', fiscalYear: 2026 }),
    },
  );

  assert.equal(response.status, 403);
  assertError(await readJson(response), 'FORBIDDEN');
  assert.equal(calls.length, 0);
});

test('年度繰り上げexecuteはkeyとrequestをrepositoryへ渡す', async () => {
  const calls = [];
  const response = await createTestApp(calls).request(
    '/api/v1/members/promote',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer owner-a',
        'content-type': 'application/json',
        'idempotency-key': 'promotion-2026-a',
      },
      body: JSON.stringify({ mode: 'execute', fiscalYear: 2026 }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal((await readJson(response)).data.status, 'completed');
  assert.equal(calls[0].idempotencyKey, 'promotion-2026-a');
  assert.equal(calls[0].mode, 'execute');
});

test('年度繰り上げの不正な年度とmodeを拒否する', async () => {
  const response = await createTestApp().request('/api/v1/members/promote', {
    method: 'POST',
    headers: {
      authorization: 'Bearer owner-a',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ mode: 'delete', fiscalYear: 1999 }),
  });

  assert.equal(response.status, 400);
  assertError(await readJson(response), 'VALIDATION_ERROR');
});

test('年度繰り上げのrequest競合は409で返す', async () => {
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
    promotionRepository: {
      run: async () => {
        const error = new Error('request conflict');
        Object.assign(error, { status: 409 });
        throw error;
      },
    },
  });

  const response = await app.request('/api/v1/members/promote', {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
      'idempotency-key': 'promotion-conflict',
    },
    body: JSON.stringify({ mode: 'execute', fiscalYear: 2026 }),
  });

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'PROMOTION_CONFLICT');
});
