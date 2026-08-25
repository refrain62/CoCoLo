import { describe, expect, it } from 'vitest';
import {
  isNotificationDeepLink,
  parseNotificationDeepLink,
} from './notification-deep-link.js';

describe('LINE通知のdeep link', () => {
  it('許可された予定・回覧のUUIDv7パスだけを解決する', () => {
    expect(
      parseNotificationDeepLink('/events/0190f3b5-7c00-7000-8000-000000000001'),
    ).toEqual({
      kind: 'event',
      id: '0190f3b5-7c00-7000-8000-000000000001',
    });
    expect(
      parseNotificationDeepLink(
        '/bulletins/0190f3b5-7c00-7000-8000-000000000002',
      ),
    ).toEqual({
      kind: 'bulletin',
      id: '0190f3b5-7c00-7000-8000-000000000002',
    });
    expect(
      isNotificationDeepLink('/events/0190f3b5-7c00-7000-8000-000000000001'),
    ).toBe(true);
  });

  it('任意パス、UUIDv4、余分なセグメントは解決しない', () => {
    expect(parseNotificationDeepLink('/admin/events')).toBeNull();
    expect(
      parseNotificationDeepLink('/events/0190f3b5-7c00-4000-8000-000000000001'),
    ).toBeNull();
    expect(
      parseNotificationDeepLink(
        '/events/0190f3b5-7c00-7000-8000-000000000001/extra',
      ),
    ).toBeNull();
    expect(isNotificationDeepLink('/https://example.com')).toBe(false);
  });
});
