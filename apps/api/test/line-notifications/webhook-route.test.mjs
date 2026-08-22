import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createLineNotificationRepository } from '../../../../packages/db/src/line-repository.ts';
import { createLineWebhookRoute } from '../../src/features/line-notifications/webhook-route.ts';

const SECRET = 'line-channel-secret-for-test';
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const GROUP_A = 'CgroupTenantA001';
const GROUP_UNKNOWN = 'CgroupUnknown001';
const DESTINATION_B = 'UofficialTenantB001';

function signature(body) {
  return createHmac('sha256', SECRET).update(body).digest('base64');
}

function webhookBody(overrides = {}) {
  return JSON.stringify({
    destination: DESTINATION_B,
    events: [
      {
        webhookEventId: 'event-1',
        type: 'message',
        timestamp: 1_787_318_400_000,
        source: {
          type: 'group',
          groupId: GROUP_A,
          userId: 'UuserShouldNotLeak001',
        },
      },
    ],
    ...overrides,
  });
}

async function postWebhook(app, body, signBody = body) {
  return app.request('/api/v1/line/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-line-signature': signature(signBody),
    },
    body,
  });
}

async function createWebhookTestApp(processEvent) {
  const repository = createLineNotificationRepository();
  await repository.upsertBinding({
    tenantId: TENANT_A,
    targetType: 'group',
    targetId: GROUP_A,
  });
  await repository.upsertBinding({
    tenantId: TENANT_B,
    targetType: 'official_account',
    targetId: DESTINATION_B,
  });
  return {
    repository,
    app: createLineWebhookRoute({
      channelSecret: SECRET,
      repository,
      processEvent,
    }),
  };
}

test('LINE Webhookは不正署名を401で拒否し、処理しない', async () => {
  const processed = [];
  const { app } = await createWebhookTestApp(async (event) => {
    processed.push(event);
  });

  const response = await app.request('/api/v1/line/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-line-signature': 'invalid-signature',
    },
    body: webhookBody(),
  });

  assert.equal(response.status, 401);
  assert.equal(processed.length, 0);
});

test('LINE Webhookは署名後に改ざんされたraw bodyを拒否する', async () => {
  const processed = [];
  const { app } = await createWebhookTestApp(async (event) => {
    processed.push(event);
  });
  const original = webhookBody();
  const tampered = webhookBody({ events: [] });

  const response = await postWebhook(app, tampered, original);

  assert.equal(response.status, 401);
  assert.equal(processed.length, 0);
});

test('LINE Webhookはwebhook event IDを重複排除する', async () => {
  const processed = [];
  const { app } = await createWebhookTestApp(async (event) => {
    processed.push(event);
  });
  const body = webhookBody({ destination: undefined });

  const first = await postWebhook(app, body);
  const second = await postWebhook(app, body);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(processed.length, 1);
  assert.equal(processed[0].tenantId, TENANT_A);
  assert.equal(processed[0].targetType, 'group');
});

test('LINE Webhookは未知groupをfail-closedで処理しない', async () => {
  const processed = [];
  const { app } = await createWebhookTestApp(async (event) => {
    processed.push(event);
  });
  const body = webhookBody({
    events: [
      {
        webhookEventId: 'event-unknown-group',
        type: 'message',
        source: { type: 'group', groupId: GROUP_UNKNOWN },
      },
    ],
  });

  const response = await postWebhook(app, body);

  assert.equal(response.status, 200);
  assert.equal(processed.length, 0);
});

test('LINE Webhookは未接続destinationをfail-closedで処理しない', async () => {
  const repository = createLineNotificationRepository();
  const processed = [];
  const app = createLineWebhookRoute({
    channelSecret: SECRET,
    repository,
    processEvent: async (event) => {
      processed.push(event);
    },
  });
  const body = JSON.stringify({
    destination: 'UofficialUnknown001',
    events: [
      {
        webhookEventId: 'event-unknown-destination',
        type: 'follow',
      },
    ],
  });

  const response = await postWebhook(app, body);

  assert.equal(response.status, 200);
  assert.equal(processed.length, 0);
});

test('LINE Webhookは接続済みdestinationからtenantを解決する', async () => {
  const processed = [];
  const { app } = await createWebhookTestApp(async (event) => {
    processed.push(event);
  });
  const body = JSON.stringify({
    destination: DESTINATION_B,
    events: [
      {
        webhookEventId: 'event-known-destination',
        type: 'follow',
      },
    ],
  });

  const response = await postWebhook(app, body);

  assert.equal(response.status, 200);
  assert.equal(processed.length, 1);
  assert.equal(processed[0].tenantId, TENANT_B);
  assert.equal(processed[0].targetType, 'official_account');
});

test('LINE Webhookはdestinationとgroupが別tenantなら処理しない', async () => {
  const processed = [];
  const { app } = await createWebhookTestApp(async (event) => {
    processed.push(event);
  });

  const response = await postWebhook(app, webhookBody());

  assert.equal(response.status, 200);
  assert.equal(processed.length, 0);
});

test('LINE Webhookは処理失敗時も秘密情報・本文・個人情報を返さない', async () => {
  const { app } = await createWebhookTestApp(async () => {
    throw new Error(`failure ${SECRET} UuserShouldNotLeak001`);
  });
  const body = webhookBody({
    destination: undefined,
    events: [
      {
        webhookEventId: 'event-processing-failure',
        type: 'message',
        source: {
          type: 'group',
          groupId: GROUP_A,
          userId: 'UuserShouldNotLeak001',
        },
        message: { type: 'text', text: '本文を返してはいけない' },
      },
    ],
  });

  const response = await postWebhook(app, body);
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.doesNotMatch(text, /line-channel-secret|本文|UuserShouldNotLeak/);
});
