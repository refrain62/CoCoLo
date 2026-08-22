import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseLineBindingInput,
  parseLineNotificationCreate,
} from '../../../../packages/contracts/src/line-contract.mjs';
import {
  buildLineAppDeepLink,
  buildLineLiffDeepLink,
  createLineDedupeKey,
  normalizeLineDeepLinkPath,
} from '../../../../packages/domain/dist/line-domain.js';

test('LINEグループIDはgroupId形式だけを受け付ける', () => {
  assert.deepEqual(
    parseLineBindingInput({
      targetType: 'group',
      groupId: 'C1234567890',
    }),
    { targetType: 'group', targetId: 'C1234567890' },
  );
  assert.throws(() =>
    parseLineBindingInput({
      targetType: 'group',
      groupId: 'https://evil.test',
    }),
  );
});

test('通知契約はtenantIdを受け付けず、イベント単位の入力を検証する', () => {
  const parsed = parseLineNotificationCreate({
    eventType: 'schedule',
    eventId: 'event-1',
    title: '予定変更',
    body: '集合時刻が変わりました。',
    deepLinkPath: '/events/event-1',
  });
  assert.equal(parsed.eventId, 'event-1');
  assert.throws(() =>
    parseLineNotificationCreate({
      eventType: 'schedule',
      eventId: 'event-1',
      title: '予定変更',
      body: '本文',
      tenantId: 'tenant-from-client',
    }),
  );
});

test('Deep Linkは同一アプリの許可パスまたはLIFFだけを生成する', () => {
  assert.equal(
    buildLineAppDeepLink('https://app.example.test', '/events/event-1'),
    'https://app.example.test/events/event-1',
  );
  assert.equal(
    buildLineLiffDeepLink('1234567890-AbCdEf', '/announcements/a-1'),
    'https://liff.line.me/1234567890-AbCdEf/announcements/a-1',
  );
  assert.throws(() => normalizeLineDeepLinkPath('https://evil.test/steal'));
  assert.throws(() =>
    normalizeLineDeepLinkPath('/events/e-1?access_token=secret'),
  );
});

test('通知の重複排除キーはtenant・種別・イベントIDを含む', () => {
  assert.equal(
    createLineDedupeKey({
      tenantId: 'tenant-a',
      eventType: 'announcement',
      eventId: 'announcement-1',
    }),
    'line:tenant-a:announcement:announcement-1',
  );
});
