import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../dist/app.js';
import type { MembershipContext, PromotionRepository } from '../src/app.js';

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const memberships: Record<string, MembershipContext> = {
  'owner-a': { tenantId: TENANT_A, role: 'owner' },
  'staff-a': { tenantId: TENANT_A, role: 'staff' },
};

type PromotionInput = Parameters<PromotionRepository['run']>[0];
type PromotionPayload = {
  data: Record<string, unknown>;
  error?: { code: string; requestId?: string };
};

function createTestApp(
  calls: PromotionInput[] = [],
  promotionResult: unknown = null,
) {
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
          result:
            input.mode === 'execute'
              ? { promotedCount: 2, changes: [] }
              : promotionResult,
        };
      },
    },
  });
}

async function readJson(response: Response): Promise<PromotionPayload> {
  return (await response.json()) as PromotionPayload;
}

function assertError(payload: PromotionPayload, code: string) {
  assert.ok(payload.error);
  assert.equal(payload.error.code, code);
  assert.ok(payload.error.requestId);
}

test('owner は年度繰り上げのプレビューで対象件数を確認できる', async () => {
  const calls: PromotionInput[] = [];
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
  const firstCall = calls[0];
  assert.ok(firstCall);
  assert.deepEqual(firstCall, {
    tenantId: TENANT_A,
    actorUserId: 'owner-a',
    role: 'owner',
    mode: 'preview',
    fiscalYear: 2026,
    idempotencyKey: null,
  });
});

test('年度繰り上げの内部JSON結果を公開レスポンスへ流出させない', async () => {
  const response = await createTestApp([], { secret: 'private-data' }).request(
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

  assert.equal(response.status, 500);
  const payload = await readJson(response);
  assert.equal(payload.error?.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(JSON.stringify(payload).includes('private-data'), false);
});

test('年度繰り上げの実行モードは Idempotency-Key なしを拒否する', async () => {
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

test('staff は年度繰り上げを実行できない', async () => {
  const calls: PromotionInput[] = [];
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

test('年度繰り上げの実行モードはキーとリクエストをリポジトリへ渡す', async () => {
  const calls: PromotionInput[] = [];
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
  const firstCall = calls[0];
  assert.ok(firstCall);
  assert.equal(firstCall.idempotencyKey, 'promotion-2026-a');
  assert.equal(firstCall.mode, 'execute');
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

test('年度繰り上げのリクエスト競合は409で返す', async () => {
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
