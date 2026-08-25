import assert from 'node:assert/strict';
import test from 'node:test';
import { createLineDeliveryProducer } from '../dist/index.js';

const TENANT_ID = '00000000-0000-7000-8000-000000000001';
const EVENT_ID = '00000000-0000-7000-8000-000000000002';
const BULLETIN_ID = '00000000-0000-7000-8000-000000000004';
const NOTIFICATION_ID = '00000000-0000-7000-8000-000000000003';
const PUBLIC_APP_URL = 'https://staging.example.test';

function createClient({ sourceExists = true } = {}) {
  const calls = [];
  const transaction = {
    $queryRaw: async (strings, ...values) => {
      const sql = strings.join('?');
      calls.push({ sql, values });
      if (sql.includes('FROM events'))
        return sourceExists ? [{ id: EVENT_ID }] : [];
      if (sql.includes('FROM announcements'))
        return sourceExists ? [{ id: BULLETIN_ID }] : [];
      if (sql.includes('FROM tenant_memberships'))
        return [{ role: 'owner', status: 'active' }];
      if (sql.includes('app_enqueue_line_delivery'))
        return [{ id: NOTIFICATION_ID }];
      return [];
    },
    auditLog: { create: async () => undefined },
  };
  return {
    calls,
    async $transaction(work) {
      return work(transaction);
    },
  };
}

const validInput = {
  tenantId: TENANT_ID,
  actorUserId: 'owner-a',
  role: 'owner',
  sourceType: 'event',
  sourceId: EVENT_ID,
  destination: 'Cgroup-a',
  title: '予定のお知らせ',
  body: '予定の詳細を確認してください。',
  idempotencyKey: 'event-notification-001',
};

test('中央LINE通知は同一tenantの通知元を検証し、server生成deep linkを登録する', async () => {
  const client = createClient();
  const producer = createLineDeliveryProducer(client, {
    notificationPublicAppUrl: PUBLIC_APP_URL,
  });

  const result = await producer.publish(validInput);

  assert.deepEqual(result, { notificationId: NOTIFICATION_ID });
  const enqueue = client.calls.find((call) =>
    call.sql.includes('app_enqueue_line_delivery'),
  );
  assert.ok(enqueue);
  assert.ok(enqueue.values.includes('event'));
  assert.ok(enqueue.values.includes(`${PUBLIC_APP_URL}/events/${EVENT_ID}`));
});

test('中央LINE通知は別tenantまたは存在しない通知元を同じエラーで拒否する', async () => {
  const client = createClient({ sourceExists: false });
  const producer = createLineDeliveryProducer(client, {
    notificationPublicAppUrl: PUBLIC_APP_URL,
  });

  await assert.rejects(
    () => producer.publish(validInput),
    /通知元の資源が存在しないか、通知を登録できません/,
  );
  assert.equal(
    client.calls.some((call) => call.sql.includes('app_enqueue_line_delivery')),
    false,
  );
});

test('中央LINE通知は回覧のdeep linkもserver側で生成する', async () => {
  const client = createClient();
  const producer = createLineDeliveryProducer(client, {
    notificationPublicAppUrl: PUBLIC_APP_URL,
  });

  await producer.publish({
    ...validInput,
    sourceType: 'bulletin',
    sourceId: BULLETIN_ID,
  });

  const enqueue = client.calls.find((call) =>
    call.sql.includes('app_enqueue_line_delivery'),
  );
  assert.ok(enqueue);
  assert.ok(enqueue.values.includes('bulletin'));
  assert.ok(enqueue.values.includes(`${PUBLIC_APP_URL}/bulletins/${BULLETIN_ID}`));
});
