import type { EventSummary } from './features/events/events-api.js';
import type { OrdersCampaign } from './features/orders-payments/orders-payments-api.js';

const TOKYO_TIME_ZONE = 'Asia/Tokyo';
const DAY_MS = 24 * 60 * 60 * 1000;

export type DashboardRange = {
  from: Date;
  to: Date;
};

export type DashboardEventItem = {
  kind: 'event';
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  eventType: EventSummary['type'];
};

export type DashboardDeadlineItem = {
  kind: 'deadline';
  id: string;
  title: string;
  deadlineAt: string;
  deadlineType: 'attendance' | 'order';
  status: OrdersCampaign['status'] | 'open';
  href: string;
};

export type DashboardItem = DashboardEventItem | DashboardDeadlineItem;

function tokyoDateParts(value: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TOKYO_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

export function tokyoDateKey(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const parts = tokyoDateParts(date);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function tokyoStart(value: Date) {
  const parts = tokyoDateParts(value);
  return new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day) - 9 * 60 * 60 * 1000,
  );
}

export function getDashboardRange(now = new Date()): DashboardRange {
  const from = tokyoStart(now);
  return { from, to: new Date(from.getTime() + 14 * DAY_MS) };
}

export function getDashboardDateKeys(range: DashboardRange) {
  return Array.from({ length: 14 }, (_, index) =>
    tokyoDateKey(new Date(range.from.getTime() + index * DAY_MS)),
  );
}

function isInRange(value: string, range: DashboardRange) {
  const time = new Date(value).getTime();
  return (
    Number.isFinite(time) &&
    time >= range.from.getTime() &&
    time < range.to.getTime()
  );
}

function overlapsRange(event: EventSummary, range: DashboardRange) {
  const startsAt = new Date(event.startsAt).getTime();
  const endsAt = new Date(event.endsAt).getTime();
  return (
    Number.isFinite(startsAt) &&
    Number.isFinite(endsAt) &&
    startsAt < range.to.getTime() &&
    endsAt > range.from.getTime()
  );
}

export function buildDashboardItems(
  events: EventSummary[],
  campaigns: OrdersCampaign[],
  range: DashboardRange,
) {
  const items: DashboardItem[] = [];
  for (const event of events) {
    if (overlapsRange(event, range))
      items.push({
        kind: 'event',
        id: event.id,
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        location: event.location,
        eventType: event.type,
      });
    if (isInRange(event.attendanceDeadline, range))
      items.push({
        kind: 'deadline',
        id: `${event.id}:attendance`,
        title: `${event.title}の出欠回答`,
        deadlineAt: event.attendanceDeadline,
        deadlineType: 'attendance',
        status: 'open',
        href: '/team/events',
      });
  }
  for (const campaign of campaigns) {
    if (isInRange(campaign.deadline, range))
      items.push({
        kind: 'deadline',
        id: `${campaign.id}:order`,
        title: `${campaign.title}の注文`,
        deadlineAt: campaign.deadline,
        deadlineType: 'order',
        status: campaign.status,
        href: '/team/orders',
      });
  }
  return items.sort((left, right) => {
    const leftAt = left.kind === 'event' ? left.startsAt : left.deadlineAt;
    const rightAt = right.kind === 'event' ? right.startsAt : right.deadlineAt;
    return new Date(leftAt).getTime() - new Date(rightAt).getTime();
  });
}

export function itemsByDate(items: DashboardItem[]) {
  const grouped = new Map<string, DashboardItem[]>();
  for (const item of items) {
    const date = tokyoDateKey(
      item.kind === 'event' ? item.startsAt : item.deadlineAt,
    );
    const current = grouped.get(date) ?? [];
    current.push(item);
    grouped.set(date, current);
  }
  return grouped;
}

export function formatDashboardDateTime(value: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: TOKYO_TIME_ZONE,
  }).format(new Date(value));
}
