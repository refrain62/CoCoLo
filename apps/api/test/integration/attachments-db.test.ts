import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrismaClient } from '@cocolo/db';
import { createAttachmentRepositories } from '@cocolo/db/attachment';
import { createAttachmentId } from '@cocolo/domain/attachment';

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const TENANT_B = '00000000-0000-7000-8000-000000000002';
const OWNER_A = 'owner-a';
const NOW = new Date('2026-08-22T00:00:00.000Z');
const ATTACHMENT_A = createAttachmentId();
const ATTACHMENT_RETRY = createAttachmentId(Date.now() + 1);

assert.ok(process.env.DATABASE_URL, 'DATABASE_URLが必要です');

const prisma = createPrismaClient();
const { attachmentRepository } = createAttachmentRepositories(prisma);

test('実PostgreSQLの添付repositoryはowner・tenant・状態遷移を同時に強制する', async () => {
  const created = await attachmentRepository.createSession({
    id: ATTACHMENT_A,
    tenantId: TENANT_A,
    ownerUserId: OWNER_A,
    role: 'owner',
    objectKey: `${TENANT_A}/attachments/${ATTACHMENT_A}`,
    mediaType: 'image/png',
    byteSize: 10,
    expiresAt: new Date(NOW.getTime() + 900_000),
    now: NOW,
  });
  assert.equal(created.status, 'uploaded');
  assert.equal(created.ownerUserId, OWNER_A);

  const available = await attachmentRepository.complete(
    {
      id: ATTACHMENT_A,
      tenantId: TENANT_A,
      ownerUserId: OWNER_A,
      role: 'owner',
      now: NOW,
    },
    async () => ({
      kind: 'available',
      sha256: 'a'.repeat(64),
      byteSize: 10,
    }),
  );
  assert.equal(available.state, 'available');
  assert.equal(available.record.status, 'available');

  const downloadable = await attachmentRepository.findAvailable({
    id: ATTACHMENT_A,
    tenantId: TENANT_A,
    ownerUserId: OWNER_A,
    role: 'owner',
  });
  assert.equal(downloadable?.id, ATTACHMENT_A);

  await assert.rejects(
    () =>
      attachmentRepository.complete(
        {
          id: ATTACHMENT_A,
          tenantId: TENANT_B,
          ownerUserId: 'owner-b',
          role: 'owner',
          now: NOW,
        },
        async () => ({
          kind: 'available',
          sha256: 'b'.repeat(64),
          byteSize: 10,
        }),
      ),
    (error: unknown) =>
      error instanceof Error &&
      'status' in error &&
      (error as { status?: unknown }).status === 404,
  );
});

test('実PostgreSQLの添付repositoryは完了検証を3回まで再試行し、4回目を拒否する', async () => {
  await attachmentRepository.createSession({
    id: ATTACHMENT_RETRY,
    tenantId: TENANT_A,
    ownerUserId: OWNER_A,
    role: 'owner',
    objectKey: `${TENANT_A}/attachments/${ATTACHMENT_RETRY}`,
    mediaType: 'image/png',
    byteSize: 10,
    expiresAt: new Date(NOW.getTime() + 900_000),
    now: NOW,
  });
  const states = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await attachmentRepository.complete(
      {
        id: ATTACHMENT_RETRY,
        tenantId: TENANT_A,
        ownerUserId: OWNER_A,
        role: 'owner',
        now: NOW,
      },
      async () => ({ kind: 'retryable', reason: 'OBJECT_NOT_READY' }),
    );
    states.push(result.state);
  }
  assert.deepEqual(states, ['retryable', 'retryable', 'rejected']);
  const rejected = await attachmentRepository.findRejectedForCleanup({
    id: ATTACHMENT_RETRY,
    tenantId: TENANT_A,
    ownerUserId: OWNER_A,
    role: 'owner',
  });
  assert.equal(rejected?.status, 'rejected');
});

test.after(async () => {
  await prisma.$disconnect();
});
