import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createMemberRepositories, createPrismaClient } from '@cocolo/db';
import { createBulletinBoardRepositories } from '@cocolo/db/bulletin-board';
import { createBulletinBoardApp } from '../../dist/features/bulletin-board/bulletin-board-app.js';

const enabled = process.env.BULLETIN_BOARD_DB_INTEGRATION === '1';
const TENANT_A = '00000000-0000-7000-8000-000000000001';
const ATTACHMENT_A = '00000000-0000-7000-8000-000000002001';

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

test('実PostgreSQLの回覧repositoryはRLS・複合tenant境界・既読競合を満たす', {
  skip: !enabled,
}, async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URLが必要です');
  const prisma = createPrismaClient();
  const { bulletinBoardRepository } = createBulletinBoardRepositories(prisma, {
    // R2 migration適用前でも、同一transactionへ添付adapterを差し替えて検証できる。
    attachmentLookup: async (_client, input) =>
      input.tenantId === TENANT_A &&
      input.attachmentIds.length === 1 &&
      input.attachmentIds[0] === ATTACHMENT_A
        ? [
            {
              id: ATTACHMENT_A,
              mediaType: 'application/pdf',
              byteSize: 1024,
            },
          ]
        : [],
    now: () => new Date('2026-08-22T00:00:00.000Z'),
    createId: randomUUID,
  });
  const { membershipRepository } = createMemberRepositories(prisma);
  const app = createBulletinBoardApp({
    verifyToken: async (token) => {
      const userId = token;
      return {
        userId,
        issuer: 'http://example.test/auth',
        audience: 'authenticated',
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      };
    },
    membershipRepository,
    bulletinBoardRepository,
  });

  try {
    const publish = await app.request('/api/v1/announcements', {
      method: 'POST',
      headers: { ...auth('owner-a'), 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'DB統合確認',
        body: '同一tenantだけに公開する。',
        attachmentIds: [ATTACHMENT_A],
      }),
    });
    assert.equal(publish.status, 201);
    const published = (await publish.json()) as { data: { id: string } };

    const guardianDetail = await app.request(
      `/api/v1/announcements/${published.data.id}`,
      { headers: auth('guardian-a') },
    );
    assert.equal(guardianDetail.status, 200);
    const read = await app.request(
      `/api/v1/announcements/${published.data.id}/read`,
      { method: 'POST', headers: auth('guardian-a') },
    );
    assert.equal(read.status, 200);
    const unread = await app.request(
      `/api/v1/announcements/${published.data.id}/unread`,
      { headers: auth('owner-a') },
    );
    assert.equal(unread.status, 200);
    const unreadPayload = (await unread.json()) as {
      data: Array<{ userId: string }>;
    };
    assert.equal(
      unreadPayload.data.some((member) => member.userId === 'guardian-a'),
      false,
    );

    const crossTenant = await app.request(
      `/api/v1/announcements/${published.data.id}`,
      { headers: auth('owner-b') },
    );
    assert.equal(crossTenant.status, 404);
  } finally {
    await prisma.$disconnect();
  }
});
