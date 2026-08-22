import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertValidEventSchedule,
  AttendancePolicyError,
} from '@cocolo/domain/event';
import { createEventsApp } from '../dist/features/events/event-api.js';

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const TENANT_B = '00000000-0000-7000-8000-000000000002';
const EVENT_A = '00000000-0000-7000-8000-000000000101';
const MEMBER_A = '00000000-0000-7000-8000-000000000201';
const MEMBER_B = '00000000-0000-7000-8000-000000000202';

const memberships = {
  'owner-a': { tenantId: TENANT_A, role: 'owner' },
  'admin-a': { tenantId: TENANT_A, role: 'admin' },
  'staff-a': { tenantId: TENANT_A, role: 'staff' },
  'guardian-a': { tenantId: TENANT_A, role: 'guardian' },
  'owner-b': { tenantId: TENANT_B, role: 'owner' },
};

function event(overrides = {}) {
  return {
    id: EVENT_A,
    tenantId: TENANT_A,
    title: '練習',
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
    ...overrides,
  };
}

function createFakeRepository() {
  const events = [event()];
  const responses = new Map();
  const assigned = new Set([`guardian-a:${MEMBER_A}`]);
  const assertEvent = (input) =>
    assertValidEventSchedule(
      {
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        attendanceDeadline: input.attendanceDeadline,
        meetingTime: input.meetingTime,
      },
      input.type,
      input.opponent,
    );
  return {
    events,
    responses,
    list: async ({ tenantId }) =>
      events.filter((current) => current.tenantId === tenantId),
    create: async ({ tenantId, actorUserId, ...input }) => {
      assertEvent(input);
      const created = event({
        ...input,
        id: `00000000-0000-7000-8000-${String(events.length + 101).padStart(12, '0')}`,
        tenantId,
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
        attendanceDeadline: input.attendanceDeadline.toISOString(),
        meetingTime: input.meetingTime?.toISOString() ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdByUserId: actorUserId,
      });
      events.push(created);
      return created;
    },
    update: async ({ tenantId, eventId, ...input }) => {
      const current = events.find(
        (candidate) => candidate.id === eventId && candidate.tenantId === tenantId,
      );
      if (!current) {
        const error = new Error('予定が見つかりません。');
        error.status = 404;
        throw error;
      }
      const next = {
        ...current,
        ...input,
        startsAt: input.startsAt ?? new Date(current.startsAt),
        endsAt: input.endsAt ?? new Date(current.endsAt),
        attendanceDeadline:
          input.attendanceDeadline ?? new Date(current.attendanceDeadline),
        meetingTime:
          input.meetingTime === undefined
            ? current.meetingTime
              ? new Date(current.meetingTime)
              : null
            : input.meetingTime,
      };
      assertEvent(next);
      Object.assign(current, {
        ...input,
        startsAt: next.startsAt.toISOString(),
        endsAt: next.endsAt.toISOString(),
        attendanceDeadline: next.attendanceDeadline.toISOString(),
        meetingTime: next.meetingTime?.toISOString() ?? null,
      });
      return current;
    },
    upsertAttendance: async ({
      tenantId,
      actorUserId,
      role,
      eventId,
      memberId,
      response,
      correctionReason,
    }) => {
      const current = events.find(
        (candidate) => candidate.id === eventId && candidate.tenantId === tenantId,
      );
      if (!current) {
        const error = new Error('予定が見つかりません。');
        error.status = 404;
        throw error;
      }
      const deadlinePassed = Date.parse(current.attendanceDeadline) < Date.now();
      if (role === 'guardian' && !assigned.has(`${actorUserId}:${memberId}`)) {
        throw new AttendancePolicyError(
          'NOT_ASSIGNED',
          '担当部員の出欠だけを変更できます。',
        );
      }
      if (role === 'guardian' && deadlinePassed) {
        throw new AttendancePolicyError(
          'DEADLINE_PASSED',
          '出欠締切後は回答を変更できません。',
        );
      }
      if (role !== 'guardian' && deadlinePassed && !correctionReason) {
        throw new AttendancePolicyError(
          'CORRECTION_REASON_REQUIRED',
          '締切後の管理者修正には理由が必要です。',
        );
      }
      const existing = [...responses.values()].find(
        (candidate) =>
          candidate.tenantId === tenantId &&
          candidate.eventId === eventId &&
          candidate.memberId === memberId &&
          (role === 'guardian' ? candidate.userId === actorUserId : true),
      );
      const value = existing ?? {
        id: `response-${responses.size + 1}`,
        tenantId,
        eventId,
        userId: existing?.userId ?? actorUserId,
        memberId,
        response,
        correctionReason: null,
        updatedAt: new Date().toISOString(),
      };
      value.response = response;
      value.correctionReason = deadlinePassed ? correctionReason ?? null : null;
      value.updatedAt = new Date().toISOString();
      responses.set(`${tenantId}:${eventId}:${value.userId}:${memberId}`, value);
      return value;
    },
    summary: async ({ tenantId, eventId }) => {
      const values = [...responses.values()].filter(
        (candidate) => candidate.tenantId === tenantId && candidate.eventId === eventId,
      );
      const answered = new Set(values.map((value) => value.memberId));
      return {
        totalMembers: 2,
        attending: values.filter((value) => value.response === 'attending').length,
        absent: values.filter((value) => value.response === 'absent').length,
        pending: values.filter((value) => value.response === 'pending').length,
        unanswered: 2 - answered.size,
        unansweredMemberIds: [MEMBER_A, MEMBER_B].filter((id) => !answered.has(id)),
      };
    },
  };
}

function createTestApp(repository = createFakeRepository()) {
  return createEventsApp({
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
    eventRepository: repository,
  });
}

async function json(response) {
  return response.json();
}

function auth(token) {
  return { authorization: `Bearer ${token}` };
}

const period = '?from=2026-08-01T00:00:00Z&to=2026-10-01T00:00:00Z';

test('未認証の予定一覧は401で拒否する', async () => {
  const response = await createTestApp().request(`/${period}`);
  assert.equal(response.status, 401);
  assert.equal((await json(response)).error.code, 'UNAUTHENTICATED');
});

test('予定のtenantId入力とguardianの登録を拒否する', async () => {
  const app = createTestApp();
  const body = {
    tenantId: TENANT_B,
    title: '越境予定',
    type: 'practice',
    startsAt: '2026-09-02T10:00:00Z',
    endsAt: '2026-09-02T12:00:00Z',
    attendanceDeadline: '2026-09-01T10:00:00Z',
    fee: 0,
    transportationRequired: false,
  };
  const crossTenant = await app.request('/', {
    method: 'POST',
    headers: { ...auth('owner-a'), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(crossTenant.status, 400);
  const forbidden = await app.request('/', {
    method: 'POST',
    headers: { ...auth('guardian-a'), 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, tenantId: undefined }),
  });
  assert.equal(forbidden.status, 403);
});

test('ownerは所属tenantの予定だけを取得し、tenantIdをDTOへ返さない', async () => {
  const response = await createTestApp().request(`/${period}`, {
    headers: auth('owner-a'),
  });
  const payload = await json(response);
  assert.equal(response.status, 200);
  assert.equal(payload.data.length, 1);
  assert.equal(payload.data[0].tenantId, undefined);
});

test('guardianは担当部員の締切前回答を一意に更新できる', async () => {
  const repository = createFakeRepository();
  repository.events[0].attendanceDeadline = new Date(Date.now() + 3_600_000).toISOString();
  const app = createTestApp(repository);
  for (const responseValue of ['attending', 'absent']) {
    const response = await app.request(`/${EVENT_A}/attendance`, {
      method: 'PUT',
      headers: { ...auth('guardian-a'), 'content-type': 'application/json' },
      body: JSON.stringify({ memberId: MEMBER_A, response: responseValue }),
    });
    assert.equal(response.status, 200);
  }
  assert.equal(repository.responses.size, 1);
  assert.equal([...repository.responses.values()][0].response, 'absent');
});

test('guardianの担当外と締切後の回答を拒否する', async () => {
  const repository = createFakeRepository();
  repository.events[0].attendanceDeadline = new Date(Date.now() - 3_600_000).toISOString();
  const app = createTestApp(repository);
  const unassigned = await app.request(`/${EVENT_A}/attendance`, {
    method: 'PUT',
    headers: { ...auth('guardian-a'), 'content-type': 'application/json' },
    body: JSON.stringify({ memberId: MEMBER_B, response: 'absent' }),
  });
  assert.equal(unassigned.status, 404);

  const late = await app.request(`/${EVENT_A}/attendance`, {
    method: 'PUT',
    headers: { ...auth('guardian-a'), 'content-type': 'application/json' },
    body: JSON.stringify({ memberId: MEMBER_A, response: 'absent' }),
  });
  assert.equal(late.status, 409);
});

test('締切後のstaff修正は理由を要求し、集計はmanagerだけに許可する', async () => {
  const repository = createFakeRepository();
  repository.events[0].attendanceDeadline = new Date(Date.now() - 3_600_000).toISOString();
  const app = createTestApp(repository);
  const noReason = await app.request(`/${EVENT_A}/attendance`, {
    method: 'PUT',
    headers: { ...auth('staff-a'), 'content-type': 'application/json' },
    body: JSON.stringify({ memberId: MEMBER_A, response: 'attending' }),
  });
  assert.equal(noReason.status, 400);
  const withReason = await app.request(`/${EVENT_A}/attendance`, {
    method: 'PUT',
    headers: { ...auth('staff-a'), 'content-type': 'application/json' },
    body: JSON.stringify({
      memberId: MEMBER_A,
      response: 'attending',
      correctionReason: '大会運営からの変更連絡',
    }),
  });
  assert.equal(withReason.status, 200);
  const summary = await app.request(`/${EVENT_A}/attendance/summary`, {
    headers: auth('owner-a'),
  });
  assert.equal(summary.status, 200);
  assert.equal((await json(summary)).data.attending, 1);
  const guardianSummary = await app.request(`/${EVENT_A}/attendance/summary`, {
    headers: auth('guardian-a'),
  });
  assert.equal(guardianSummary.status, 403);
});

test('不正な時刻関係の予定登録を拒否する', async () => {
  const app = createTestApp();
  const response = await app.request('/', {
    method: 'POST',
    headers: { ...auth('staff-a'), 'content-type': 'application/json' },
    body: JSON.stringify({
      title: '時刻不正',
      type: 'practice',
      startsAt: '2026-09-02T10:00:00Z',
      endsAt: '2026-09-02T09:00:00Z',
      attendanceDeadline: '2026-09-01T10:00:00Z',
      fee: 0,
      transportationRequired: false,
    }),
  });
  assert.equal(response.status, 400);
});
