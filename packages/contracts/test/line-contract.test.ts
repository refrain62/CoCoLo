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
