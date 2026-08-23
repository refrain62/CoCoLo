import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  AttendanceRecord,
  AttendanceSummary,
  EventRecord,
  EventRepository,
} from '@cocolo/db/events';
import type { MembershipContext } from '../dist/app.js';
import { createApp } from '../dist/app.js';

const TENANT_ID = '00000000-0000-7000-8000-000000000001';
const EVENT_ID = '00000000-0000-7000-8000-000000000101';
const MEMBER_ID = '00000000-0000-7000-8000-000000000201';

const event: EventRecord = {
  id: EVENT_ID,
  tenantId: TENANT_ID,
  title: '中央APIの予定',
  type: 'practice',
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

const attendance: AttendanceRecord = {
  id: '00000000-0000-7000-8000-000000000301',
  eventId: EVENT_ID,
  userId: 'guardian-a',
  memberId: MEMBER_ID,
  response: 'attending',
  correctionReason: null,
  respondedAt: '2026-08-22T00:00:00.000Z',
  updatedAt: '2026-08-22T00:00:00.000Z',
};

const summary: AttendanceSummary = {
  totalMembers: 1,
  attending: 1,
  absent: 0,
  pending: 0,
  unanswered: 0,
  unansweredMemberIds: [],
};

function createRepository(): EventRepository {
  return {
    list: async () => [event],
    create: async () => event,
    update: async () => event,
    upsertAttendance: async () => attendance,
    summary: async () => summary,
  };
}

function createTestApp() {
  const memberships: Record<string, MembershipContext> = {
    'owner-a': { tenantId: TENANT_ID, role: 'owner' },
    'guardian-a': { tenantId: TENANT_ID, role: 'guardian' },
  };
  return createApp({
    verifyToken: async (token) => {
      if (!memberships[token]) throw new Error('invalid token');
      return {
        userId: token,
        issuer: 'https://example.supabase.co/auth/v1',
        audience: 'authenticated',
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      };
    },
    membershipRepository: {
      findActiveByUserId: async (userId) => memberships[userId] ?? null,
    },
    eventRepository: createRepository(),
  });
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const period = '?from=2026-08-01T00:00:00Z&to=2026-10-01T00:00:00Z';

test('中央APIへeventsをmountし、response契約とtenant非公開projectionを適用する', async () => {
  const app = createTestApp();
  const response = await app.request(`/api/v1/events${period}`, {
    headers: auth('owner-a'),
  });
  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    data: Array<Record<string, unknown>>;
  };
  assert.equal(payload.data[0]?.id, EVENT_ID);
  assert.equal(payload.data[0]?.tenantId, undefined);
});

test('中央APIのevents認証なしアクセスをhandler前に拒否する', async () => {
  const response = await createTestApp().request(`/api/v1/events${period}`);
  assert.equal(response.status, 401);
  const payload = (await response.json()) as {
    error: { code: string; requestId: string };
  };
  assert.equal(payload.error.code, 'UNAUTHENTICATED');
  assert.match(
    payload.error.requestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test('認証済みcontextをWebが取得できる', async () => {
  const response = await createTestApp().request('/api/v1/auth/context', {
    headers: auth('owner-a'),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: { tenantId: TENANT_ID, role: 'owner' },
  });
});
