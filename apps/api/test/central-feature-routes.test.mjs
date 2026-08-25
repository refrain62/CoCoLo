import assert from 'node:assert/strict';
import test from 'node:test';
import { selectedTeamHeaderName } from '@cocolo/contracts/auth-team-selection';
import { createInMemoryOrdersRepository } from '@cocolo/db/orders';
import { createApp } from '../dist/app.js';

const USER_ID = 'user-central-a';
const TENANT_ID = '00000000-0000-7000-8000-000000000001';

function createTestApp({
  multipleMemberships = false,
  featureOverrides = {},
  featureContractEnabled = true,
} = {}) {
  const verifyToken = async (token) => {
    if (token !== USER_ID) throw new Error('invalid token');
    return {
      userId: USER_ID,
      issuer: 'https://example.supabase.co/auth/v1',
      audience: 'authenticated',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      authProviders: ['line'],
      authProviderSubjects: { line: 'line-subject-a' },
    };
  };
  const membershipRepository = {
    findActiveByUserId: async (userId) =>
      userId === USER_ID && !multipleMemberships
        ? { tenantId: TENANT_ID, role: 'owner' }
        : null,
  };
  const freeFeatureKeys = new Set([
    'members',
    'board-contacts',
    'events-attendance',
    'bulletin-board',
    'attachments',
  ]);
  const featureSnapshot = () => ({
    planKey: null,
    planStatus: null,
    features: [
      ['members', 'メンバー管理'],
      ['board-contacts', '役員・連絡先'],
      ['orders-payments', '購買・集金'],
      ['events-attendance', '予定・出欠'],
      ['bulletin-board', '回覧・添付'],
      ['attachments', '添付ファイル'],
      ['line-notifications', 'LINE通知'],
      ['ride-operations', '送迎管理'],
    ].map(([key, displayName]) => {
      const enabled = featureOverrides[key] ?? true;
      return {
        key,
        billingType: freeFeatureKeys.has(key) ? 'free' : 'paid',
        displayName,
        enabled,
        reason: enabled ? 'default' : 'unavailable',
      };
    }),
  });
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
      authInvitations: {
        repository: {
          list: async () => [
            {
              id: '00000000-0000-7000-8000-000000000010',
              memberId: '00000000-0000-7000-8000-000000000011',
              role: 'guardian',
              relationship: '保護者',
              status: 'pending',
              expiresAt: new Date('2026-08-28T00:00:00.000Z'),
              acceptedAt: null,
            },
          ],
          create: async () => ({
            id: '00000000-0000-7000-8000-000000000010',
            memberId: '00000000-0000-7000-8000-000000000011',
            role: 'guardian',
            relationship: '保護者',
            status: 'pending',
            expiresAt: new Date('2026-08-28T00:00:00.000Z'),
            acceptedAt: null,
            token: 'a'.repeat(64),
          }),
          revoke: async () => ({
            id: '00000000-0000-7000-8000-000000000010',
            memberId: '00000000-0000-7000-8000-000000000011',
            role: 'guardian',
            relationship: '保護者',
            status: 'revoked',
            expiresAt: new Date('2026-08-28T00:00:00.000Z'),
            acceptedAt: null,
          }),
          accept: async () => ({
            tenantId: TENANT_ID,
            memberId: '00000000-0000-7000-8000-000000000011',
            role: 'guardian',
            linkStatus: 'active',
          }),
        },
        invitationUrlBase: 'https://app.example.test/invite',
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
          copyYear: async () => ({ records: [], copiedCount: 0 }),
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
      featureContract: featureContractEnabled
        ? {
            repository: {
              get: async () => featureSnapshot(),
              setFreeFlag: async () => ({
                planKey: null,
                planStatus: null,
                features: [
                  {
                    key: 'members',
                    billingType: 'free',
                    displayName: 'メンバー管理',
                    enabled: false,
                    reason: 'flag',
                  },
                ],
              }),
            },
          }
        : undefined,
      orders: {
        repository: createInMemoryOrdersRepository(),
      },
      ride: {
        service: {
          listPlans: async () => [],
          createPlan: async () => ({}),
          updatePlan: async () => ({}),
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
          transitionPlan: async (_actor, _planId, input) => ({
            id: '00000000-0000-7000-8000-000000000001',
            title: '練習試合',
            departureAt: '2026-08-23T00:00:00.000Z',
            pickupMapsUrl: null,
            destinationMapsUrl: null,
            status: input.action === 'finalize' ? 'finalized' : 'closed',
            createdAt: '2026-08-22T00:00:00.000Z',
          }),
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

test('ownerは対象memberへのopaque招待を発行・一覧できる', async () => {
  const app = createTestApp();
  const headers = { authorization: `Bearer ${USER_ID}` };
  const list = await app.request('/api/v1/auth/invitations', { headers });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).data[0].status, 'pending');

  const created = await app.request('/api/v1/auth/invitations', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      memberId: '00000000-0000-7000-8000-000000000011',
      role: 'guardian',
      relationship: '保護者',
    }),
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal('token' in createdBody.data, false);
  assert.match(
    createdBody.data.inviteUrl,
    /^https:\/\/app\.example\.test\/invite\/[^#]+#token=[A-Za-z0-9_-]+$/,
  );
});

test('membershipがないOAuth利用者もopaque招待を受諾できる', async () => {
  const response = await createTestApp().request(
    '/api/v1/auth/invitations/accept',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${USER_ID}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ token: 'a'.repeat(64), provider: 'line' }),
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    tenantId: TENANT_ID,
    memberId: '00000000-0000-7000-8000-000000000011',
    role: 'guardian',
    linkStatus: 'active',
  });
});

test('招待受諾はJWTで確認できないproviderを本文から選べない', async () => {
  const response = await createTestApp().request(
    '/api/v1/auth/invitations/accept',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${USER_ID}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ token: 'a'.repeat(64), provider: 'google' }),
    },
  );

  assert.equal(response.status, 403);
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

test('中央APIへfeature契約routeをmountし、tenantの有効機能を返す', async () => {
  const response = await createTestApp({
    featureOverrides: { 'orders-payments': false },
  }).request('/api/v1/feature-contract', {
    headers: { authorization: `Bearer ${USER_ID}` },
  });

  assert.equal(response.status, 200);
  const feature = (await response.json()).data.features.find(
    (item) => item.key === 'orders-payments',
  );
  assert.deepEqual(feature, {
    key: 'orders-payments',
    billingType: 'paid',
    displayName: '購買・集金',
    enabled: false,
    reason: 'unavailable',
  });
});

test('契約で無効なpaid featureは業務handlerを実行せず403にする', async () => {
  const response = await createTestApp({
    featureOverrides: { 'orders-payments': false },
  }).request('/api/v1/orders', {
    headers: { authorization: `Bearer ${USER_ID}` },
  });

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'FEATURE_UNAVAILABLE');
});

test('契約で無効なfree featureも業務handlerを実行せず403にする', async () => {
  const response = await createTestApp({
    featureOverrides: { 'bulletin-board': false },
  }).request('/api/v1/announcements', {
    headers: { authorization: `Bearer ${USER_ID}` },
  });

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'FEATURE_UNAVAILABLE');
});

test('契約で無効な役員・連絡先featureも業務handlerを実行せず403にする', async () => {
  const response = await createTestApp({
    featureOverrides: { 'board-contacts': false },
  }).request('/api/v1/board-members', {
    headers: { authorization: `Bearer ${USER_ID}` },
  });

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'FEATURE_UNAVAILABLE');
});

test('役員・連絡先はfeature契約未設定時にfail-closedする', async () => {
  const response = await createTestApp({
    featureContractEnabled: false,
  }).request('/api/v1/board-members', {
    headers: { authorization: `Bearer ${USER_ID}` },
  });

  assert.equal(response.status, 503);
  assert.equal(
    (await response.json()).error.code,
    'FEATURE_CONTRACT_NOT_CONFIGURED',
  );
});

test('feature契約の無料flag変更はowner/adminだけが呼び出せる', async () => {
  const response = await createTestApp().request(
    '/api/v1/feature-contract/members',
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${USER_ID}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ enabled: false, reason: 'チーム運用で停止' }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.features[0].enabled, false);
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

test('送迎の状態変更routeも中央response契約を通る', async () => {
  const response = await createTestApp().request(
    '/api/v1/ride-plans/00000000-0000-7000-8000-000000000001/status',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${USER_ID}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action: 'close' }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.status, 'closed');
});

test('無効な送迎featureは状態変更handlerを実行せず403にする', async () => {
  const response = await createTestApp({
    featureOverrides: { 'ride-operations': false },
  }).request(
    '/api/v1/ride-plans/00000000-0000-7000-8000-000000000001/status',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${USER_ID}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action: 'close' }),
    },
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'FEATURE_UNAVAILABLE');
});

test('feature契約未設定の送迎はfail-closedする', async () => {
  const response = await createTestApp({ featureContractEnabled: false }).request(
    '/api/v1/ride-plans',
    { headers: { authorization: `Bearer ${USER_ID}` } },
  );

  assert.equal(response.status, 503);
  assert.equal(
    (await response.json()).error.code,
    'FEATURE_CONTRACT_NOT_CONFIGURED',
  );
});
