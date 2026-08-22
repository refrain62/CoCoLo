import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLineDeepLink,
  buildLineLiffLink,
  createUuidV7,
} from '../dist/line-domain.js';

test('deep-linkは予定と回覧の同一環境画面を作る', () => {
  assert.equal(
    buildLineDeepLink('https://staging.example.test', 'event', 'event-001'),
    'https://staging.example.test/events/event-001',
  );
  assert.equal(
    buildLineDeepLink('https://staging.example.test', 'bulletin', 'notice-001'),
    'https://staging.example.test/bulletins/notice-001',
  );
});

test('LIFFリンクは許可されたstateだけを持つ', () => {
  const link = new URL(
    buildLineLiffLink('2000000000-AbCdEf', 'event', 'event-001'),
  );
  assert.equal(link.origin, 'https://liff.line.me');
  assert.equal(link.pathname, '/2000000000-AbCdEf');
  assert.equal(link.searchParams.get('liff.state'), '/events/event-001');
});

test('local repository用UUIDv7はversion 7とvariantを持つ', () => {
  const id = createUuidV7(1724284800000);
  assert.equal(id[14], '7');
  assert.ok(['8', '9', 'a', 'b'].includes(id[19].toLowerCase()));
});
