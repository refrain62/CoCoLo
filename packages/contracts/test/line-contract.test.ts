import assert from 'node:assert/strict';
import test from 'node:test';
import {
  lineConnectInputSchema,
  lineConnectResponseSchema,
  lineNotificationInputSchema,
  lineStatusResponseSchema,
  lineWebhookBodySchema,
  lineWebhookResponseSchema,
} from '../src/line-contract.ts';
import { lineDeliveryPublishSchema } from '../src/line-delivery-contract.ts';

test('LINE契約はtenantIdを入力として受け付けない', () => {
  assert.equal(
    lineConnectInputSchema.safeParse({
      groupId: 'Cgroup-a',
      tenantId: 'tenant-a',
    }).success,
    false,
  );
});

test('通知元と同一環境のdeep-linkを含む通知だけ契約を通す', () => {
  assert.equal(
    lineNotificationInputSchema.safeParse({
      sourceType: 'event',
      sourceId: 'event-001',
      title: '予定',
      body: '本文',
      deepLink: 'https://staging.example.test/events/event-001',
    }).success,
    true,
  );
  assert.equal(
    lineNotificationInputSchema.safeParse({
      sourceType: 'event',
      sourceId: 'event/001',
      title: '予定',
      body: '本文',
      deepLink: 'https://staging.example.test/events/event%2F001',
    }).success,
    false,
  );
});

test('webhookイベントのgroupIdと重複排除IDを必須にする', () => {
  assert.equal(
    lineWebhookBodySchema.safeParse({
      destination: 'Udestination',
      events: [
        {
          type: 'message',
          timestamp: 1,
          source: { type: 'group', groupId: 'Cgroup-a' },
          webhookEventId: 'event-001',
        },
      ],
    }).success,
    true,
  );
  assert.equal(
    lineWebhookBodySchema.safeParse({
      destination: 'Udestination',
      events: [{ type: 'message', timestamp: 1, source: { type: 'group' } }],
    }).success,
    false,
  );
});

test('LINE公開レスポンスはfeature固有の項目だけを許可する', () => {
  assert.equal(
    lineStatusResponseSchema.safeParse({
      data: { status: 'connected', groupId: 'Cgroup-a' },
    }).success,
    true,
  );
  assert.equal(
    lineConnectResponseSchema.safeParse({
      data: { status: 'connected', groupId: 'Cgroup-a', tenantId: 'tenant-a' },
    }).success,
    false,
  );
  assert.equal(
    lineWebhookResponseSchema.safeParse({
      data: { accepted: 1, duplicates: 0, ignored: 0, tenantId: 'tenant-a' },
    }).success,
    false,
  );
});

test('中央LINE通知は資源種別とUUIDv7の資源IDを要求する', () => {
  const base = {
    sourceType: 'event',
    sourceId: '00000000-0000-7000-8000-000000000001',
    destination: 'Cgroup-a',
    title: '予定のお知らせ',
    body: '本文',
  };
  assert.equal(lineDeliveryPublishSchema.safeParse(base).success, true);
  assert.equal(
    lineDeliveryPublishSchema.safeParse({
      ...base,
      sourceType: 'event',
      sourceId: 'event-001',
    }).success,
    false,
  );
  assert.equal(
    lineDeliveryPublishSchema.safeParse({
      ...base,
      deepLink:
        'https://evil.example.test/events/00000000-0000-7000-8000-000000000001',
    }).success,
    false,
  );
});
