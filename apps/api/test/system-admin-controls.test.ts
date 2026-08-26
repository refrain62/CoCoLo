import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../dist/app.js';

const announcement = {
  id: '0198b5a8-0000-7000-8000-000000000001',
  title: 'メンテナンスのお知らせ',
  body: '停止時間のお知らせです。',
  status: 'published' as const,
  publishedAt: new Date('2026-08-27T00:00:00.000Z'),
  createdAt: new Date('2026-08-26T00:00:00.000Z'),
  updatedAt: new Date('2026-08-27T00:00:00.000Z'),
};

const feature = {
  key: 'orders-payments',
  billingType: 'paid' as const,
  displayName: '購買・集金',
  systemEnabled: true,
};

function createTestApp(calls: string[] = []) {
  return createApp({
    verifyToken: async (token) => ({
      userId: token,
      issuer: 'https://example.supabase.co/auth/v1',
      audience: 'authenticated',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      systemAdmin: token === 'system-admin',
    }),
    systemAdminRepository: {
      listAnnouncements: async (actorUserId) => {
        calls.push(`listAnnouncements:${actorUserId}`);
        return [announcement];
      },
      createAnnouncement: async ({ actorUserId, title, body, status }) => {
        calls.push(`createAnnouncement:${actorUserId}`);
        return { ...announcement, title, body, status };
      },
      updateAnnouncement: async ({ actorUserId, announcementId, ...input }) => {
        calls.push(`updateAnnouncement:${actorUserId}:${announcementId}`);
        return { ...announcement, ...input };
      },
      listFeatures: async (actorUserId) => {
        calls.push(`listFeatures:${actorUserId}`);
        return [feature];
      },
      setFeatureEnabled: async ({ actorUserId, featureKey, enabled }) => {
        calls.push(`setFeatureEnabled:${actorUserId}:${featureKey}`);
        return { ...feature, key: featureKey, systemEnabled: enabled };
      },
    },
  });
}

test('system adminは全体お知らせと機能提供状態を操作できる', async () => {
  const calls: string[] = [];
  const app = createTestApp(calls);
  const headers = {
    authorization: 'Bearer system-admin',
    'X-CoCoLo-Team-Id': '0198b5a8-0000-7000-8000-000000000099',
  };

  const listResponse = await app.request('/api/v1/system/announcements', {
    headers,
  });
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).data[0].title, announcement.title);

  const createResponse = await app.request('/api/v1/system/announcements', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      title: '新しいお知らせ',
      body: '本文',
      status: 'draft',
    }),
  });
  assert.equal(createResponse.status, 201);

  const featureResponse = await app.request(
    '/api/v1/system/features/orders-payments',
    {
      method: 'PATCH',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false, reason: '障害対応' }),
    },
  );
  assert.equal(featureResponse.status, 200);
  assert.equal((await featureResponse.json()).data.systemEnabled, false);
  assert.deepEqual(calls, [
    'listAnnouncements:system-admin',
    'createAnnouncement:system-admin',
    'setFeatureEnabled:system-admin:orders-payments',
  ]);
});

test('system admin APIはtenant headerを権限判定に使わず、一般利用者を拒否する', async () => {
  const calls: string[] = [];
  const response = await createTestApp(calls).request(
    '/api/v1/system/features',
    {
      headers: {
        authorization: 'Bearer tenant-user',
        'X-CoCoLo-Team-Id': '0198b5a8-0000-7000-8000-000000000099',
      },
    },
  );
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test('system admin repositoryが未設定なら認証後に503を返す', async () => {
  const app = createApp({
    verifyToken: async () => ({
      userId: 'system-admin',
      issuer: 'https://example.supabase.co/auth/v1',
      audience: 'authenticated',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      systemAdmin: true,
    }),
  });
  const response = await app.request('/api/v1/system/announcements', {
    headers: { authorization: 'Bearer system-admin' },
  });
  assert.equal(response.status, 503);
});
