import { describe, expect, it } from 'vitest';
import type { EventSummary } from './features/events/events-api.js';
import type { OrdersCampaign } from './features/orders-payments/orders-payments-api.js';
import {
  buildDashboardItems,
  getDashboardDateKeys,
  getDashboardRange,
  itemsByDate,
} from './user-dashboard-utils.js';

const event = {
  id: '00000000-0000-7000-8000-000000000001',
  title: '朝練',
  type: 'practice',
  startsAt: '2026-08-26T00:00:00.000Z',
  endsAt: '2026-08-26T02:00:00.000Z',
  location: '体育館',
  itemsToBring: null,
  fee: 0,
  announcementImageAttachmentId: null,
  opponent: null,
  meetingTime: null,
  transportationRequired: false,
  attendanceDeadline: '2026-08-27T03:00:00.000Z',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
} satisfies EventSummary;

const campaign = {
  id: '00000000-0000-7000-8000-000000000002',
  title: 'ユニフォーム',
  deadline: '2026-08-28T03:00:00.000Z',
  status: 'open',
  products: [],
  createdAt: '2026-08-20T00:00:00.000Z',
} satisfies OrdersCampaign;

describe('利用者ダッシュボードの期間と表示項目', () => {
  it('東京時間の当日から14日間を半開区間で作る', () => {
    const range = getDashboardRange(new Date('2026-08-26T14:00:00.000Z'));
    expect(range.from.toISOString()).toBe('2026-08-25T15:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-09-08T15:00:00.000Z');
    expect(getDashboardDateKeys(range)).toHaveLength(14);
  });

  it('予定・出欠締切・注文締切を日付別にまとめる', () => {
    const range = getDashboardRange(new Date('2026-08-26T00:00:00.000Z'));
    const items = buildDashboardItems([event], [campaign], range);
    expect(items.map((item) => item.kind)).toEqual([
      'event',
      'deadline',
      'deadline',
    ]);
    expect(itemsByDate(items).get('2026-08-26')).toHaveLength(1);
    expect(itemsByDate(items).get('2026-08-27')).toHaveLength(1);
    expect(itemsByDate(items).get('2026-08-28')).toHaveLength(1);
  });

  it('開催期間外でも期間内の出欠締切を表示項目に含める', () => {
    const range = getDashboardRange(new Date('2026-08-26T00:00:00.000Z'));
    const lateEvent = {
      ...event,
      id: '00000000-0000-7000-8000-000000000003',
      startsAt: '2026-09-10T00:00:00.000Z',
      endsAt: '2026-09-10T02:00:00.000Z',
      attendanceDeadline: '2026-08-28T03:00:00.000Z',
    } satisfies EventSummary;

    const items = buildDashboardItems([lateEvent], [], range);

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('deadline');
  });
});
