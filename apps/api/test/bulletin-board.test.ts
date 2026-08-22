import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  BulletinBoardListInput,
  BulletinBoardPublishInput,
  BulletinBoardReadInput,
} from '@cocolo/db/bulletin-board';
import type { AnnouncementRecord } from '@cocolo/domain/bulletin-board';
import { createBulletinBoardApp } from '../dist/features/bulletin-board/bulletin-board-app.js';

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const TENANT_B = '00000000-0000-7000-8000-000000000002';
const ANNOUNCEMENT_A = '00000000-0000-7000-8000-000000001001';
const ANNOUNCEMENT_B = '00000000-0000-7000-8000-000000001002';
const ATTACHMENT_A = '00000000-0000-7000-8000-000000002001';
const ATTACHMENT_B = '00000000-0000-7000-8000-000000002002';
const UNKNOWN_ATTACHMENT = '00000000-0000-7000-8000-000000002099';

const memberships = {
  'owner-a': { tenantId: TENANT_A, role: 'owner' as const },
  'admin-a': { tenantId: TENANT_A, role: 'admin' as const },
  'staff-a': { tenantId: TENANT_A, role: 'staff' as const },
  'guardian-a': { tenantId: TENANT_A, role: 'guardian' as const },
  'owner-b': { tenantId: TENANT_B, role: 'owner' as const },
  'guardian-b': { tenantId: TENANT_B, role: 'guardian' as const },
};

const activeMembers = [
  { userId: 'owner-a', ...memberships['owner-a'] },
  { userId: 'admin-a', ...memberships['admin-a'] },
  { userId: 'staff-a', ...memberships['staff-a'] },
  { userId: 'guardian-a', ...memberships['guardian-a'] },
  { userId: 'owner-b', ...memberships['owner-b'] },
  { userId: 'guardian-b', ...memberships['guardian-b'] },
];

const attachmentRecords = new Map([
  [
    ATTACHMENT_A,
    {
      id: ATTACHMENT_A,
      tenantId: TENANT_A,
      mediaType: 'application/pdf' as const,
      byteSize: 1024,
      status: 'available' as const,
    },
  ],
  [
    ATTACHMENT_B,
    {
      id: ATTACHMENT_B,
      tenantId: TENANT_B,
      mediaType: 'application/pdf' as const,
      byteSize: 2048,
      status: 'available' as const,
    },
  ],
]);

type MemoryAnnouncement = AnnouncementRecord & { isAuthor: boolean };

function createMemoryRepository() {
  const announcements = new Map<string, MemoryAnnouncement>();
  const reads = new Map<string, Date>();
  let nextId = 1;
  return {
    announcements,
    reads,
    async publish(input: BulletinBoardPublishInput) {
      const attachments = input.attachmentIds.map((id: string) => {
        const attachment = attachmentRecords.get(id);
        if (
          !attachment ||
          attachment.tenantId !== input.tenantId ||
          attachment.status !== 'available'
        ) {
          const error = new Error('attachment unavailable') as Error & {
            status: number;
          };
          error.status = 404;
          throw error;
        }
        return {
          id: attachment.id,
          mediaType: attachment.mediaType,
          byteSize: attachment.byteSize,
        };
      });
      const id = nextId === 1 ? ANNOUNCEMENT_A : ANNOUNCEMENT_B;
      nextId += 1;
      const record = {
        id,
        tenantId: input.tenantId,
        authorUserId: input.actorUserId,
        title: input.title,
        body: input.body,
        status: 'published' as const,
        publishedAt: new Date('2026-08-22T00:00:00.000Z'),
        attachments,
        readAt: null,
        isAuthor: true,
      };
      announcements.set(id, record);
      return record;
    },
    async list(input: BulletinBoardListInput) {
      const data = [...announcements.values()]
        .filter(
          (announcement) =>
            announcement.tenantId === input.tenantId &&
            announcement.status === 'published',
        )
        .map((announcement) => {
          const readAt =
            reads.get(`${announcement.id}:${input.userId}`) ?? null;
          return {
            id: announcement.id,
            title: announcement.title,
            status: announcement.status,
            publishedAt: announcement.publishedAt,
            attachmentCount: announcement.attachments.length,
            readAt,
            isAuthor: announcement.authorUserId === input.userId,
          };
        });
      return { data, hasNext: false };
    },
    async find(input: {
      tenantId: string;
      userId: string;
      role: BulletinBoardReadInput['role'];
      announcementId: string;
    }) {
      const announcement = announcements.get(input.announcementId);
      if (
        !announcement ||
        announcement.tenantId !== input.tenantId ||
        announcement.status !== 'published'
      )
        return null;
      return {
        ...announcement,
        readAt: reads.get(`${announcement.id}:${input.userId}`) ?? null,
        isAuthor: announcement.authorUserId === input.userId,
      };
    },
    async markRead(input: BulletinBoardReadInput) {
      const announcement = announcements.get(input.announcementId);
      if (
        !announcement ||
        announcement.tenantId !== input.tenantId ||
        announcement.status !== 'published'
      )
        return null;
      const key = `${input.announcementId}:${input.actorUserId}`;
      const existing = reads.get(key);
      if (existing) return { readAt: existing };
      const readAt = new Date('2026-08-22T01:00:00.000Z');
      reads.set(key, readAt);
      return { readAt };
    },
    async listUnread(input: BulletinBoardReadInput) {
      const announcement = announcements.get(input.announcementId);
      if (
        !announcement ||
        announcement.tenantId !== input.tenantId ||
        announcement.status !== 'published' ||
        announcement.authorUserId !== input.actorUserId
      )
        return null;
      return activeMembers
        .filter((member) => member.tenantId === input.tenantId)
        .filter(
          (member) => !reads.has(`${input.announcementId}:${member.userId}`),
        )
        .map((member) => ({ userId: member.userId, role: member.role }));
    },
  };
}

function createTestApp() {
  const repository = createMemoryRepository();
  const app = createBulletinBoardApp({
    verifyToken: async (token) => {
      if (!(token in memberships)) throw new Error('invalid token');
      return {
        userId: token,
        issuer: 'https://example.supabase.co/auth/v1',
        audience: 'authenticated',
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      };
    },
    membershipRepository: {
      findActiveByUserId: async (userId) =>
        memberships[userId as keyof typeof memberships] ?? null,
    },
    bulletinBoardRepository: repository,
  });
  return { app, repository };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function json<T>(response: Response) {
  return response.json() as Promise<T>;
}

test('未認証とguardianの掲載を拒否し、staffの掲載を許可する', async () => {
  const { app } = createTestApp();
  assert.equal((await app.request('/api/v1/announcements')).status, 401);
  const guardian = await app.request('/api/v1/announcements', {
    method: 'POST',
    headers: { ...auth('guardian-a'), 'content-type': 'application/json' },
    body: JSON.stringify({ title: '権限確認', body: '本文' }),
  });
  assert.equal(guardian.status, 403);
  const staff = await app.request('/api/v1/announcements', {
    method: 'POST',
    headers: { ...auth('staff-a'), 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'スタッフ掲載', body: '本文' }),
  });
  assert.equal(staff.status, 201);
});

test('添付IDは同一テナントのavailableだけを受け付け、失敗理由を区別しない', async () => {
  const { app } = createTestApp();
  async function publishWithAttachment(token: string, attachmentId: string) {
    return app.request('/api/v1/announcements', {
      method: 'POST',
      headers: { ...auth(token), 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '添付検証',
        body: '本文',
        attachmentIds: [attachmentId],
      }),
    });
  }
  const unknown = await publishWithAttachment('owner-a', UNKNOWN_ATTACHMENT);
  const crossTenant = await publishWithAttachment('owner-a', ATTACHMENT_B);
  assert.equal(unknown.status, 404);
  assert.equal(crossTenant.status, 404);
  assert.equal(
    (await json<{ error: { code: string } }>(unknown)).error.code,
    'ATTACHMENT_NOT_FOUND',
  );
  assert.equal(
    (await json<{ error: { code: string } }>(crossTenant)).error.code,
    'ATTACHMENT_NOT_FOUND',
  );
  const valid = await publishWithAttachment('owner-a', ATTACHMENT_A);
  assert.equal(valid.status, 201);
  const payload = await json<{
    data: {
      attachments: Array<{ mediaType: string }>;
      authorUserId?: string;
      tenantId?: string;
    };
  }>(valid);
  assert.equal(payload.data.attachments[0]?.mediaType, 'application/pdf');
  assert.equal(payload.data.authorUserId, undefined);
  assert.equal(payload.data.tenantId, undefined);
});

test('利用者は本文と添付メタデータを参照でき、既読はユーザー単位で冪等に記録される', async () => {
  const { app } = createTestApp();
  const created = await app.request('/api/v1/announcements', {
    method: 'POST',
    headers: { ...auth('owner-a'), 'content-type': 'application/json' },
    body: JSON.stringify({
      title: '総会資料',
      body: '資料を確認してください。',
      attachmentIds: [ATTACHMENT_A],
    }),
  });
  const announcementId = (await json<{ data: { id: string } }>(created)).data
    .id;
  const detail = await app.request(`/api/v1/announcements/${announcementId}`, {
    headers: auth('guardian-a'),
  });
  const detailPayload = await json<{
    data: {
      body: string;
      readAt: string | null;
      attachments: Array<Record<string, unknown>>;
    };
  }>(detail);
  assert.equal(detail.status, 200);
  assert.equal(detailPayload.data.body, '資料を確認してください。');
  assert.deepEqual(detailPayload.data.attachments, [
    { id: ATTACHMENT_A, mediaType: 'application/pdf', byteSize: 1024 },
  ]);
  assert.equal(detailPayload.data.readAt, null);
  const firstRead = await app.request(
    `/api/v1/announcements/${announcementId}/read`,
    { method: 'POST', headers: auth('guardian-a') },
  );
  const secondRead = await app.request(
    `/api/v1/announcements/${announcementId}/read`,
    { method: 'POST', headers: auth('guardian-a') },
  );
  assert.equal(firstRead.status, 200);
  assert.equal(secondRead.status, 200);
  assert.equal(
    (await json<{ data: { readAt: string } }>(firstRead)).data.readAt,
    (await json<{ data: { readAt: string } }>(secondRead)).data.readAt,
  );
  const ownerList = await app.request('/api/v1/announcements', {
    headers: auth('owner-a'),
  });
  assert.equal(
    (await json<{ data: Array<{ isRead: boolean }> }>(ownerList)).data[0]
      ?.isRead,
    false,
  );
  const guardianList = await app.request('/api/v1/announcements', {
    headers: auth('guardian-a'),
  });
  assert.equal(
    (await json<{ data: Array<{ isRead: boolean }> }>(guardianList)).data[0]
      ?.isRead,
    true,
  );
});

test('未読者一覧は掲載者本人だけに公開し、ユーザーID以外の個人情報を返さない', async () => {
  const { app } = createTestApp();
  const created = await app.request('/api/v1/announcements', {
    method: 'POST',
    headers: { ...auth('owner-a'), 'content-type': 'application/json' },
    body: JSON.stringify({ title: '未読確認', body: '本文' }),
  });
  const announcementId = (await json<{ data: { id: string } }>(created)).data
    .id;
  const ownerUnread = await app.request(
    `/api/v1/announcements/${announcementId}/unread`,
    { headers: auth('owner-a') },
  );
  const ownerPayload = await json<{
    data: Array<{ userId: string; role: string } & Record<string, unknown>>;
  }>(ownerUnread);
  assert.equal(ownerUnread.status, 200);
  assert.ok(ownerPayload.data.some((member) => member.userId === 'guardian-a'));
  assert.equal(ownerPayload.data[0].email, undefined);
  const staffUnread = await app.request(
    `/api/v1/announcements/${announcementId}/unread`,
    { headers: auth('staff-a') },
  );
  const otherId = await app.request(
    `/api/v1/announcements/${ANNOUNCEMENT_B}/unread`,
    { headers: auth('owner-a') },
  );
  assert.equal(staffUnread.status, 404);
  assert.equal(otherId.status, 404);
  assert.equal(
    (await json<{ error: { code: string } }>(staffUnread)).error.code,
    (await json<{ error: { code: string } }>(otherId)).error.code,
  );
});

test('別テナントの回覧を一覧・詳細・既読操作から隠し、active membershipなしを拒否する', async () => {
  const { app } = createTestApp();
  const ownerB = await app.request('/api/v1/announcements', {
    method: 'POST',
    headers: { ...auth('owner-b'), 'content-type': 'application/json' },
    body: JSON.stringify({ title: '別テナント', body: '本文' }),
  });
  const id = (await json<{ data: { id: string } }>(ownerB)).data.id;
  const ownerAList = await app.request('/api/v1/announcements', {
    headers: auth('owner-a'),
  });
  assert.equal((await json<{ data: unknown[] }>(ownerAList)).data.length, 0);
  const crossDetail = await app.request(`/api/v1/announcements/${id}`, {
    headers: auth('owner-a'),
  });
  const crossRead = await app.request(`/api/v1/announcements/${id}/read`, {
    method: 'POST',
    headers: auth('owner-a'),
  });
  assert.equal(crossDetail.status, 404);
  assert.equal(crossRead.status, 404);

  const suspendedApp = createBulletinBoardApp({
    verifyToken: async () => ({
      userId: 'suspended-a',
      issuer: 'https://example.supabase.co/auth/v1',
      audience: 'authenticated',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    }),
    membershipRepository: {
      findActiveByUserId: async () => null,
    },
  });
  const suspended = await suspendedApp.request('/api/v1/announcements', {
    headers: auth('suspended-token'),
  });
  assert.equal(suspended.status, 403);
});
