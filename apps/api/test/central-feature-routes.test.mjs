import assert from 'node:assert/strict';
import test from 'node:test';
import { selectedTeamHeaderName } from '@cocolo/contracts/auth-team-selection';
import { createApp } from '../dist/app.js';

const USER_ID = 'user-central-a';
const TENANT_ID = '00000000-0000-7000-8000-000000000001';

function createTestApp({ multipleMemberships = false } = {}) {
  const verifyToken = async (token) => {
    if (token !== USER_ID) throw new Error('invalid token');
    return {
      userId: USER_ID,
      issuer: 'https://example.supabase.co/auth/v1',
      audience: 'authenticated',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    };
  };
  const membershipRepository = {
    findActiveByUserId: async (userId) =>
      userId === USER_ID && !multipleMemberships
        ? { tenantId: TENANT_ID, role: 'owner' }
        : null,
  };
  return createApp({
    verifyToken,
    membershipRepository,
    centralFeatures: {
      authTeamSelection: {
        repository: {
          listActiveMemberships: async () => [
            {
              tenantId: TENANT_ID,
              tenantName: 'テストチーム',
              role: 'owner',
              status: 'active',
              createdAt: new Date('2026-08-24T00:00:00.000Z'),
            },
          ],
          findActiveMembership: async (_userId, tenantId) =>
            tenantId === TENANT_ID
              ? {
                  tenantId: TENANT_ID,
                  tenantName: 'テストチーム',
                  role: 'owner',
                  status: 'active',
                  createdAt: new Date('2026-08-24T00:00:00.000Z'),
                }
              : null,
        },
      },
      boardContact: {
        repository: {
          list: async () => [],
          create: async () => {
            throw new Error('unused');
          },
          update: async () => null,
          remove: async () => null,
          copyYear: async () => [],
        },
      },
      ride: {
        service: {
          createPlan: async () => ({}),
          createOffer: async () => ({}),
          createRequest: async () => ({}),
          getSnapshot: async () => ({
            plan: {},
            offers: [],
            requests: [],
            assignments: [],
            history: [],
          }),
          autoMatch: async () => ({ assignments: [], unassignedRequestIds: [] }),
          assign: async () => ({}),
          getDispatch: async () => ({}),
          getMetrics: async () => ({}),
        },
      },
    },
  });
}

test('中央APIへチーム選択routeをmountする', async () => {
  const response = await createTestApp().request('/api/v1/auth/teams', {
    headers: { authorization: `Bearer ${USER_ID}` },
  });

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data[0], {
    tenantId: TENANT_ID,
    tenantName: 'テストチーム',
    role: 'owner',
  });
});

test('中央APIへ役員連絡先routeをmountする', async () => {
  const response = await createTestApp().request('/api/v1/board-members', {
    headers: { authorization: `Bearer ${USER_ID}` },
  });

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, []);
});

test('選択中チームを中央APIの業務認証へ反映する', async () => {
  const app = createTestApp({ multipleMemberships: true });
  const headers = {
    authorization: `Bearer ${USER_ID}`,
    [selectedTeamHeaderName]: TENANT_ID,
  };

  const selected = await app.request('/api/v1/board-members', { headers });
  assert.equal(selected.status, 200);

  const unselected = await app.request('/api/v1/board-members', {
    headers: { authorization: `Bearer ${USER_ID}` },
  });
  assert.equal(unselected.status, 403);
});

test('中央APIへmountした送迎routeは認証前に未認証を拒否する', async () => {
  const response = await createTestApp().request(
    '/api/v1/ride-plans/00000000-0000-7000-8000-000000000001',
  );

  assert.equal(response.status, 401);
});
