import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthTeamSelectionRepository } from '@cocolo/db/auth-team-selection';
import type { EventRepository } from '@cocolo/db/events';
import type { AuthTeamMembership } from '@cocolo/domain/auth-team-selection';
import { createApp } from '../dist/app.js';

const TEAM_A = '00000000-0000-7000-8000-000000000001';
const TEAM_B = '00000000-0000-7000-8000-000000000002';
const EVENT_A = '00000000-0000-7000-8000-000000000101';

type ApiBody = {
  data?: unknown;
  error?: { code?: string };
};

async function json(response: Response) {
  return (await response.json()) as ApiBody;
}

function verifyToken(token: string) {
  if (token === 'token-a')
    return Promise.resolve({
      userId: 'user-a',
      issuer: 'https://example.supabase.co/auth/v1',
      audience: 'authenticated',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    });
  if (token === 'token-without-membership')
    return Promise.resolve({
      userId: 'user-without-membership',
      issuer: 'https://example.supabase.co/auth/v1',
      audience: 'authenticated',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    });
  return Promise.reject(new Error('invalid token'));
}

function membershipRepository() {
  return {
    findActiveByUserId: async (userId: string) =>
      userId === 'user-a' ? { tenantId: TEAM_A, role: 'owner' as const } : null,
  };
}

function teamRepository(): AuthTeamSelectionRepository {
  const memberships: AuthTeamMembership[] = [
    {
      tenantId: TEAM_A,
      tenantName: 'アルファチーム',
      role: 'owner',
      status: 'active',
      createdAt: '2026-08-22T00:00:00.000Z',
    },
    {
      tenantId: TEAM_B,
      tenantName: 'ベータチーム',
      role: 'staff',
      status: 'active',
      createdAt: '2026-08-22T00:00:00.000Z',
    },
  ];
  return {
    listActiveMemberships: async () => memberships,
    findActiveMembership: async (_userId, tenantId) =>
      memberships.find((membership) => membership.tenantId === tenantId) ??
      null,
  };
}

function eventRepository() {
  const calls: unknown[] = [];
  // 中央mountの接続だけを検証するため、DBの書き込み処理はテスト対象外に固定する。
  const repository = {
    get: async (input: {
      tenantId: string;
      actorUserId: string;
      role: string;
      eventId: string;
    }) => {
      calls.push(input);
      if (input.eventId !== EVENT_A)
        throw Object.assign(new Error('予定が見つかりません。'), {
          status: 404,
        });
      return {
        id: EVENT_A,
        tenantId: input.tenantId,
        title: '中央mount予定',
        type: 'practice' as const,
        startsAt: '2026-09-01T10:00:00.000Z',
        endsAt: '2026-09-01T12:00:00.000Z',
        location: null,
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
    },
  } as unknown as EventRepository;
  return { repository, calls };
}

function createTestApp(withTeamSelection = false) {
  return createApp({
    verifyToken,
    membershipRepository: membershipRepository(),
    central: {
      features: withTeamSelection
        ? { authTeamSelection: { repository: teamRepository() } }
        : undefined,
      logSink: () => undefined,
    },
  });
}

const authHeaders = { authorization: 'Bearer token-a' };

test('sessionはactive membershipのtenantIdとroleだけを返す', async () => {
  const response = await createTestApp().request('/api/v1/session', {
    headers: authHeaders,
  });

  assert.equal(response.status, 200);
  assert.deepEqual((await json(response)).data, {
    tenantId: TEAM_A,
    role: 'owner',
  });
});

test('sessionは未認証を401、所属なしを403でfail-closedにする', async () => {
  const app = createTestApp();
  const unauthenticated = await app.request('/api/v1/session');
  const withoutMembership = await app.request('/api/v1/session', {
    headers: { authorization: 'Bearer token-without-membership' },
  });

  assert.equal(unauthenticated.status, 401);
  assert.equal((await json(unauthenticated)).error?.code, 'UNAUTHENTICATED');
  assert.equal(withoutMembership.status, 403);
  assert.equal((await json(withoutMembership)).error?.code, 'FORBIDDEN');
});

test('Auth team selectionはWeb契約の/api/v1/auth配下へmountされる', async () => {
  const app = createTestApp(true);
  const response = await app.request('/api/v1/auth/teams', {
    headers: authHeaders,
  });

  assert.equal(response.status, 200);
  assert.deepEqual((await json(response)).data, [
    { tenantId: TEAM_A, tenantName: 'アルファチーム', role: 'owner' },
    { tenantId: TEAM_B, tenantName: 'ベータチーム', role: 'staff' },
  ]);
  assert.equal(
    (await app.request('/api/v1/teams', { headers: authHeaders })).status,
    404,
  );
});

test('未接続featureは中央APIで明示503、unknown pathは404にする', async () => {
  const app = createTestApp();
  const unavailable = await app.request('/api/v1/events', {
    headers: authHeaders,
  });
  const unknown = await app.request('/api/v1/not-registered', {
    headers: authHeaders,
  });

  assert.equal(unavailable.status, 503);
  assert.equal((await json(unavailable)).error?.code, 'FEATURE_NOT_CONFIGURED');
  assert.equal(unknown.status, 404);
  assert.equal((await json(unknown)).error?.code, 'NOT_FOUND');
});

test('予定詳細は中央API mountから所属情報付きで取得する', async () => {
  const eventStore = eventRepository();
  const app = createApp({
    verifyToken,
    membershipRepository: membershipRepository(),
    central: {
      features: { events: { repository: eventStore.repository } },
      logSink: () => undefined,
    },
  });
  const response = await app.request(`/api/v1/events/${EVENT_A}`, {
    headers: authHeaders,
  });
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.equal((body.data as { id: string }).id, EVENT_A);
  assert.equal((body.data as { tenantId?: string }).tenantId, undefined);
  assert.deepEqual(eventStore.calls, [
    {
      tenantId: TEAM_A,
      actorUserId: 'user-a',
      role: 'owner',
      eventId: EVENT_A,
    },
  ]);

  const missing = await app.request(
    '/api/v1/events/00000000-0000-7000-8000-000000000199',
    { headers: authHeaders },
  );
  assert.equal(missing.status, 404);
});

test('中央path validationはfeatureへ不正なUUIDを渡さない', async () => {
  const response = await createTestApp().request('/api/v1/events/not-a-uuid', {
    headers: authHeaders,
  });

  assert.equal(response.status, 400);
  assert.equal((await json(response)).error?.code, 'VALIDATION_ERROR');
});
