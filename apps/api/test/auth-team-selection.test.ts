import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthTeamSelectionRepository } from '@cocolo/db/auth-team-selection';
import type { AuthTeamMembership } from '@cocolo/domain/auth-team-selection';
import { createAuthTeamSelectionApp } from '../dist/features/auth-team-selection/app.js';

const TEAM_A = '00000000-0000-7000-8000-000000000001';
const TEAM_B = '00000000-0000-7000-8000-000000000002';
const TEAM_SUSPENDED = '00000000-0000-7000-8000-000000000003';
const TEAM_INVITED = '00000000-0000-7000-8000-000000000004';

const activeMemberships: Record<string, AuthTeamMembership[]> = {
  'user-a': [
    {
      tenantId: TEAM_B,
      tenantName: 'ベータチーム',
      role: 'staff',
      status: 'active',
      createdAt: '2026-08-22T00:00:00.000Z',
    },
    {
      tenantId: TEAM_A,
      tenantName: 'アルファチーム',
      role: 'owner',
      status: 'active',
      createdAt: '2026-08-22T00:00:00.000Z',
    },
  ],
};

function createRepository(): AuthTeamSelectionRepository {
  return {
    async listActiveMemberships(userId) {
      return activeMemberships[userId] ?? [];
    },
    async findActiveMembership(userId, tenantId) {
      return (
        activeMemberships[userId]?.find(
          (membership) => membership.tenantId === tenantId,
        ) ?? null
      );
    },
  };
}

function createTestApp() {
  return createAuthTeamSelectionApp({
    verifyToken: async (token) => {
      if (token !== 'token-user-a') throw new Error('invalid token');
      return {
        userId: 'user-a',
        issuer: 'https://example.supabase.co/auth/v1',
        audience: 'authenticated',
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      };
    },
    repository: createRepository(),
  });
}

async function readJson(response: Response) {
  return (await response.json()) as {
    data?: Array<Record<string, unknown>> | Record<string, unknown>;
    error?: { code?: string; requestId?: string };
  };
}

function authHeaders(): HeadersInit {
  return { authorization: 'Bearer token-user-a' };
}

test('複数のactive所属を暗黙選択せず、明示的な一覧を返す', async () => {
  const response = await createTestApp().request('/teams', {
    headers: authHeaders(),
  });
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body.data, [
    { tenantId: TEAM_A, tenantName: 'アルファチーム', role: 'owner' },
    { tenantId: TEAM_B, tenantName: 'ベータチーム', role: 'staff' },
  ]);
});

test('選択要求は所属を再検証し、同じ利用者がチームを切り替えられる', async () => {
  const app = createTestApp();
  const first = await app.request('/teams/select', {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ tenantId: TEAM_A }),
  });
  const second = await app.request('/teams/select', {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ tenantId: TEAM_B }),
  });

  assert.equal(first.status, 200);
  assert.deepEqual((await readJson(first)).data, {
    tenantId: TEAM_A,
    tenantName: 'アルファチーム',
    role: 'owner',
  });
  assert.equal(second.status, 200);
  assert.deepEqual((await readJson(second)).data, {
    tenantId: TEAM_B,
    tenantName: 'ベータチーム',
    role: 'staff',
  });
});

test('別利用者の所属を指定しても403で存在を明かさない', async () => {
  const response = await createTestApp().request('/teams/select', {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({
      tenantId: '00000000-0000-7000-8000-000000000099',
    }),
  });
  const body = await readJson(response);

  assert.equal(response.status, 403);
  assert.equal(body.error?.code, 'FORBIDDEN');
  assert.ok(body.error?.requestId);
});

test('suspendedとinvitedは一覧と選択の対象外にする', async () => {
  const repository: AuthTeamSelectionRepository = {
    async listActiveMemberships() {
      return [
        {
          tenantId: TEAM_SUSPENDED,
          tenantName: '停止チーム',
          role: 'admin',
          status: 'suspended',
          createdAt: '2026-08-22T00:00:00.000Z',
        },
        {
          tenantId: TEAM_INVITED,
          tenantName: '招待チーム',
          role: 'guardian',
          status: 'invited',
          createdAt: '2026-08-22T00:00:00.000Z',
        },
      ];
    },
    async findActiveMembership() {
      return null;
    },
  };
  const app = createAuthTeamSelectionApp({
    verifyToken: async () => ({
      userId: 'user-a',
      issuer: 'https://example.supabase.co/auth/v1',
      audience: 'authenticated',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    }),
    repository,
  });

  const listResponse = await app.request('/teams', {
    headers: authHeaders(),
  });
  const selectResponse = await app.request('/teams/select', {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ tenantId: TEAM_SUSPENDED }),
  });

  assert.equal(listResponse.status, 403);
  assert.equal(selectResponse.status, 403);
});

test('tenantIdの形式と未知キーをAPI境界で拒否する', async () => {
  const response = await createTestApp().request('/teams/select', {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({
      tenantId: '00000000-0000-4000-8000-000000000001',
      role: 'owner',
    }),
  });

  assert.equal(response.status, 400);
  assert.equal((await readJson(response)).error?.code, 'VALIDATION_ERROR');
});

test('未認証と不正tokenは401で拒否する', async () => {
  const app = createTestApp();
  const unauthenticated = await app.request('/teams');
  const invalid = await app.request('/teams', {
    headers: { authorization: 'Bearer invalid' },
  });

  assert.equal(unauthenticated.status, 401);
  assert.equal(invalid.status, 401);
});
