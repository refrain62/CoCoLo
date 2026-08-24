import assert from 'node:assert/strict';
import test from 'node:test';
import { selectedTeamHeaderName } from '@cocolo/contracts/auth-team-selection';
import { createInMemoryOrdersRepository } from '@cocolo/db/orders';
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
      attachments: {
        repository: {
          createSession: async () => ({}),
          listExpiredUploaded: async () => [],
        },
        storage: {
          createSignedUpload: async () => ({
            url: 'https://uploads.example.test/signed',
            expiresAt: new Date(Date.now() + 60_000),
          }),
          readObject: async () => null,
          createSignedDownload: async () => ({
            url: 'https://uploads.example.test/download',
            expiresAt: new Date(Date.now() + 60_000),
          }),
          deleteObject: async () => undefined,
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
      bulletinBoard: {
        repository: {
          list: async () => ({ data: [], hasNext: false }),
          publish: async () => {
            throw new Error('unused');
          },
          find: async () => null,
          markRead: async () => null,
          listUnread: async () => null,
        },
      },
      orders: {
        repository: createInMemoryOrdersRepository(),
      },
      ride: {
        service: {
          listPlans: async () => [],
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

test('中央APIへ回覧板routeをmountし、公開response契約を適用する', async () => {
  const response = await createTestApp().request('/api/v1/announcements', {
    headers: { authorization: `Bearer ${USER_ID}` },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: [],
    page: 1,
    pageSize: 50,
    hasNext: false,
  });
});

test('中央APIへ添付upload routeをmountし、中央認証を利用する', async () => {
  const response = await createTestApp().request('/api/v1/uploads', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${USER_ID}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ mediaType: 'image/png', byteSize: 4 }),
  });

  assert.equal(response.status, 201);
  assert.equal((await response.json()).mediaType, 'image/png');
});

test('中央APIへ添付cleanup routeをmountし、公開response契約を適用する', async () => {
  const response = await createTestApp().request(
    '/api/v1/uploads/cleanup-expired',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${USER_ID}` },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: { scannedCount: 0, cleanedCount: 0, pendingCount: 0 },
  });
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

test('中央APIへ注文routeをmountし、選択中tenantとresponse契約を適用する', async () => {
  const app = createTestApp({ multipleMemberships: true });
  const response = await app.request('/api/v1/orders', {
    headers: {
      authorization: `Bearer ${USER_ID}`,
      [selectedTeamHeaderName]: TENANT_ID,
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, []);

  const unselected = await app.request('/api/v1/orders', {
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

test('中央APIへ送迎routeをmountし、公開response契約を適用する', async () => {
  const response = await createTestApp().request('/api/v1/ride-plans', {
    headers: { authorization: `Bearer ${USER_ID}` },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: [] });
});
