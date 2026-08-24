import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createInMemoryLineRepository } from '@cocolo/db/line';
import { createApp } from '../dist/app.js';
import {
  createFakeLineAdapter,
  createLineMessagingAdapter,
  createLineNotificationApp,
  createLineNotificationService,
  type LineActor,
} from '../dist/features/line-notifications/index.js';

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const TENANT_B = '00000000-0000-7000-8000-000000000002';
const OWNER_A: LineActor = {
  tenantId: TENANT_A,
  userId: 'owner-a',
  role: 'owner',
};
const OWNER_B: LineActor = {
  tenantId: TENANT_B,
  userId: 'owner-b',
  role: 'owner',
};
const BASE_URL = 'https://staging.example.test';
const CHANNEL_SECRET = 'channel-secret';

function createFixture() {
  const repository = createInMemoryLineRepository({
    idFactory: (() => {
      let next = 1;
      return () =>
        `00000000-0000-7000-8000-${String(next++).padStart(12, '0')}`;
    })(),
  });
  const adapter = createFakeLineAdapter();
  let current = new Date('2026-08-22T00:00:00.000Z');
  const service = createLineNotificationService({
    repository,
    adapter,
    channelSecret: CHANNEL_SECRET,
    webhookDestination: 'Udestination',
    publicAppUrl: BASE_URL,
    now: () => new Date(current),
  });
  return {
    repository,
    adapter,
    service,
    setNow(value: string | Date) {
      current = new Date(value);
    },
  };
}

function notificationInput(overrides = {}) {
  return {
    sourceType: 'event',
    sourceId: 'event-001',
    title: '練習のお知らせ',
    body: '18時から開始します。',
    deepLink: `${BASE_URL}/events/event-001`,
    ...overrides,
  };
}

function webhookBody(groupId = 'Cgroup-a', webhookEventId = 'event-001') {
  return JSON.stringify({
    destination: 'Udestination',
    events: [
      {
        type: 'message',
        timestamp: 1724284800000,
        source: { type: 'group', groupId },
        webhookEventId,
      },
    ],
  });
}

function signature(body: string) {
  return createHmac('sha256', CHANNEL_SECRET).update(body).digest('base64');
}

test('未接続状態はエラーではなく未接続として返し、キューへ登録しない', async () => {
  const { service, repository } = createFixture();
  const result = await service.enqueue(OWNER_A, notificationInput());

  assert.deepEqual(result, { status: 'not_connected', notification: null });
  assert.equal(
    await repository.getNotification({
      ...OWNER_A,
      notificationId: '00000000-0000-7000-8000-000000000001',
    }),
    null,
  );
});

test('groupIdはtenantへ一意に紐付き、別tenantから参照・接続できない', async () => {
  const { service } = createFixture();
  await service.connect(OWNER_A, { groupId: 'Cgroup-a' });

  assert.equal((await service.status(OWNER_B)).status, 'disconnected');
  await assert.rejects(
    () => service.connect(OWNER_B, { groupId: 'Cgroup-a' }),
    /別のチームへ接続済み/,
  );
});

test('同一origin以外のdeep-linkは通知へ登録できない', async () => {
  const { service } = createFixture();
  await service.connect(OWNER_A, { groupId: 'Cgroup-a' });

  await assert.rejects(
    () =>
      service.enqueue(
        OWNER_A,
        notificationInput({ deepLink: 'https://evil.test/phishing' }),
      ),
    /同一環境だけ/,
  );
  await assert.rejects(
    () =>
      service.enqueue(
        OWNER_A,
        notificationInput({ deepLink: `${BASE_URL}/admin` }),
      ),
    /同一環境だけ/,
  );
});

test('未接続tenantの古いキューが接続済みtenantの配信を妨げない', async () => {
  const { service, adapter } = createFixture();
  await service.connect(OWNER_A, { groupId: 'Cgroup-a' });
  await service.connect(OWNER_B, { groupId: 'Cgroup-b' });
  const queuedA = await service.enqueue(
    OWNER_A,
    notificationInput({
      sourceId: 'event-a',
      deepLink: `${BASE_URL}/events/event-a`,
    }),
  );
  const queuedB = await service.enqueue(
    OWNER_B,
    notificationInput({
      sourceId: 'event-b',
      deepLink: `${BASE_URL}/events/event-b`,
    }),
  );
  await service.disconnect(OWNER_A);

  const sent = await service.deliverOne(new Date('2026-08-22T00:00:00.000Z'));
  assert.ok(queuedB.notification);
  assert.ok(adapter.sentMessages[0]);
  assert.equal(sent?.id, queuedB.notification.id);
  assert.equal(adapter.sentMessages[0].groupId, 'Cgroup-b');
  assert.equal(queuedA.status, 'queued');
});

test('接続解除後に別groupへ再接続しても古い通知を新groupへ送らない', async () => {
  const { service, adapter } = createFixture();
  await service.connect(OWNER_A, { groupId: 'Cgroup-a' });
  await service.enqueue(OWNER_A, notificationInput());
  await service.disconnect(OWNER_A);
  await service.connect(OWNER_A, { groupId: 'Cgroup-new' });

  assert.equal(
    await service.deliverOne(new Date('2026-08-22T00:00:00.000Z')),
    null,
  );
  assert.equal(adapter.sentMessages.length, 0);
});

test('送信失敗はfailedと次回時刻を残し、期限到来後にfake adapterで再試行できる', async () => {
  const { service, adapter, repository, setNow } = createFixture();
  await service.connect(OWNER_A, { groupId: 'Cgroup-a' });
  const queued = await service.enqueue(OWNER_A, notificationInput());
  assert.equal(queued.status, 'queued');
  adapter.failNext();

  const failed = await service.deliverOne(new Date('2026-08-22T00:00:00.000Z'));
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.attempts, 1);
  assert.ok(failed?.nextRetryAt);

  setNow(failed.nextRetryAt);
  const sent = await service.deliverOne(failed.nextRetryAt);
  assert.equal(sent?.status, 'sent');
  assert.equal(adapter.sentMessages.length, 1);
  assert.equal(
    (
      await repository.getNotification({
        ...OWNER_A,
        notificationId: queued.notification.id,
      })
    )?.status,
    'sent',
  );
});

test('LINE webhookは署名を確認し、対象groupのイベントだけ一度受け付ける', async () => {
  const { service } = createFixture();
  await service.connect(OWNER_A, { groupId: 'Cgroup-a' });
  const body = webhookBody();

  assert.deepEqual(
    await service.receiveWebhook({ rawBody: body, signature: signature(body) }),
    { accepted: 1, duplicates: 0, ignored: 0 },
  );
  assert.deepEqual(
    await service.receiveWebhook({ rawBody: body, signature: signature(body) }),
    { accepted: 0, duplicates: 1, ignored: 0 },
  );
  const unknown = webhookBody('Cunknown', 'event-unknown');
  assert.deepEqual(
    await service.receiveWebhook({
      rawBody: unknown,
      signature: signature(unknown),
    }),
    { accepted: 0, duplicates: 0, ignored: 1 },
  );
  await assert.rejects(
    () => service.receiveWebhook({ rawBody: body, signature: 'invalid' }),
    /署名が不正/,
  );
  const oversized = 'x'.repeat(1024 * 1024 + 1);
  await assert.rejects(
    () =>
      service.receiveWebhook({
        rawBody: oversized,
        signature: signature(oversized),
      }),
    /本文が大きすぎ/,
  );
  const wrongDestination = JSON.stringify({
    destination: 'Uother',
    events: [],
  });
  await assert.rejects(
    () =>
      service.receiveWebhook({
        rawBody: wrongDestination,
        signature: signature(wrongDestination),
      }),
    /送信先が不正/,
  );
});

test('最大試行回数を超えた通知は自動再試行しない', async () => {
  const { service, adapter } = createFixture();
  await service.connect(OWNER_A, { groupId: 'Cgroup-a' });
  await service.enqueue(OWNER_A, notificationInput());
  adapter.failNext(5);
  let current = new Date('2026-08-22T00:00:00.000Z');
  let last: Awaited<ReturnType<typeof service.deliverOne>> = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    last = await service.deliverOne(current);
    assert.ok(last);
    assert.equal(last.status, 'failed');
    if (last.nextRetryAt) current = last.nextRetryAt;
  }
  assert.ok(last);
  assert.equal(last.attempts, 5);
  assert.equal(last.nextRetryAt, null);
  assert.equal(await service.deliverOne(current), null);
});

test('実LINE adapterはchannel access tokenをAuthorizationだけへ設定する', async () => {
  let request:
    | { input: RequestInfo | URL; init: RequestInit | undefined }
    | undefined;
  const adapter = createLineMessagingAdapter({
    channelAccessToken: 'secret-token',
    endpoint: 'https://line.test/push',
    fetchImpl: async (input, init) => {
      request = { input, init };
      return new Response(null, {
        status: 200,
        headers: { 'x-line-request-id': 'provider-001' },
      });
    },
  });

  const result = await adapter.send({
    groupId: 'Cgroup-a',
    notification: {
      id: '00000000-0000-7000-8000-000000000001',
      title: '予定',
      body: '本文',
      deepLink: `${BASE_URL}/events/event-001`,
    },
  });
  assert.equal(result.providerMessageId, 'provider-001');
  assert.ok(request);
  assert.ok(request.init);
  assert.equal(request.input, 'https://line.test/push');
  assert.equal(
    new Headers(request.init.headers).get('Authorization'),
    'Bearer secret-token',
  );
  assert.equal(String(request.init.body).includes('secret-token'), false);
});

test('専用routeは未認証を拒否し、tenantId入力を受け付けず、staffの接続変更を拒否する', async () => {
  const fixture = createFixture();
  const app = createLineNotificationApp({
    service: fixture.service,
    verifyToken: async (token) => ({
      userId: token,
      issuer: 'https://example.supabase.co/auth/v1',
      audience: 'authenticated',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    }),
    findActiveMembership: async (userId) =>
      userId === 'staff-a'
        ? { tenantId: TENANT_A, role: 'staff' }
        : { tenantId: TENANT_A, role: 'owner' },
  });

  assert.equal((await app.request('/api/v1/line/status')).status, 401);
  const crossTenant = await app.request('/api/v1/line/connect', {
    method: 'POST',
    headers: {
      authorization: 'Bearer owner-a',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ groupId: 'Cgroup-a', tenantId: TENANT_B }),
  });
  assert.equal(crossTenant.status, 400);
  const staff = await app.request('/api/v1/line/connect', {
    method: 'POST',
    headers: {
      authorization: 'Bearer staff-a',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ groupId: 'Cgroup-a' }),
  });
  assert.equal(staff.status, 403);
});

test('LINEの認証済み操作を中央APIへmountできる', async () => {
  const fixture = createFixture();
  const app = createApp({
    verifyToken: async (token) => ({
      userId: token,
      issuer: 'https://example.supabase.co/auth/v1',
      audience: 'authenticated',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    }),
    membershipRepository: {
      findActiveByUserId: async () => ({ tenantId: TENANT_A, role: 'owner' }),
    },
    centralFeatures: { line: { service: fixture.service } },
  });

  const response = await app.request('/api/v1/line/status', {
    headers: { authorization: 'Bearer owner-a' },
  });

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    status: 'disconnected',
    groupId: null,
  });

  const notificationResponse = await app.request('/api/v1/line/notifications', {
    headers: { authorization: 'Bearer owner-a' },
  });
  assert.equal(notificationResponse.status, 404);
});
