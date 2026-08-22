import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EventDetailView } from './event-detail-page.js';
import type { EventsApi } from './events-api.js';

const api = {} as EventsApi;

const event = {
  id: 'event-a',
  title: '秋季練習',
  type: 'practice' as const,
  startsAt: '2026-09-01T10:00:00.000Z',
  endsAt: '2026-09-01T12:00:00.000Z',
  location: '体育館',
  itemsToBring: null,
  fee: 0,
  announcementImageAttachmentId: null,
  opponent: null,
  meetingTime: null,
  transportationRequired: false,
  attendanceDeadline: '2026-08-31T10:00:00.000Z',
  createdAt: '2026-08-22T00:00:00.000Z',
  updatedAt: '2026-08-22T00:00:00.000Z',
};

describe('EventDetailView', () => {
  it('guardianへ担当部員の回答欄と未回答状態を表示する', () => {
    const markup = renderToStaticMarkup(
      createElement(EventDetailView, {
        api,
        event,
        memberOptions: [{ id: 'member-a', name: '部員A' }],
        role: 'guardian',
      }),
    );

    expect(markup).toContain('出欠回答');
    expect(markup).toContain('部員A');
    expect(markup).toContain('回答状態: 未回答');
    expect(markup).not.toContain('出欠集計');
    expect(markup).not.toContain('予定を編集');
  });

  it('managerへ締切後の修正理由欄と集計・予定管理を表示する', () => {
    const markup = renderToStaticMarkup(
      createElement(EventDetailView, {
        api,
        event: {
          ...event,
          attendanceDeadline: '2026-08-01T10:00:00.000Z',
        },
        memberOptions: [{ id: 'member-a', name: '部員A' }],
        role: 'staff',
      }),
    );

    expect(markup).toContain('予定の管理');
    expect(markup).toContain('予定を編集');
    expect(markup).toContain('締切後の管理者修正理由（必須）');
    expect(markup).toContain('出欠集計');
  });
});
