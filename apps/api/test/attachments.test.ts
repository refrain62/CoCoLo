import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type {
  AttachmentRecord,
  AttachmentRepository,
  AttachmentVerification,
  CompleteAttachmentInput,
  CreateAttachmentSessionInput,
  ExpiredAttachmentCleanupInput,
} from '@cocolo/domain/attachment';
import { createAttachmentApp } from '../dist/features/attachments/attachment-app.js';
import { createFakeAttachmentStorage } from '../dist/features/attachments/fake-attachment-storage.js';
import type { FakeAttachmentStorage } from '../dist/features/attachments/fake-attachment-storage.js';

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const TENANT_B = '00000000-0000-7000-8000-000000000002';
type TestUser = {
  tenantId: string;
  role: CreateAttachmentSessionInput['role'];
};

const USERS: Record<string, TestUser> = {
  'owner-a': { tenantId: TENANT_A, role: 'owner' },
  'staff-a': { tenantId: TENANT_A, role: 'staff' },
  'guardian-a': { tenantId: TENANT_A, role: 'guardian' },
  'owner-b': { tenantId: TENANT_B, role: 'owner' },
};

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02,
]);

type TestRepository = AttachmentRepository & {
  records: Map<string, AttachmentRecord>;
  cleanupAttempts: Array<{
    id: string;
    tenantId: string;
    ownerUserId: string;
    role: CreateAttachmentSessionInput['role'];
    completed: boolean;
  }>;
};

function createMemoryRepository(): TestRepository {
  const records = new Map<string, AttachmentRecord>();
  const cleanupAttempts: TestRepository['cleanupAttempts'] = [];
  return {
    records,
    cleanupAttempts,
    async createSession(input: CreateAttachmentSessionInput) {
      const record: AttachmentRecord = {
        id: input.id,
        tenantId: input.tenantId,
        ownerUserId: input.ownerUserId,
        objectKey: input.objectKey,
        mediaType: input.mediaType,
        byteSize: input.byteSize,
        sha256: null,
        status: 'uploaded',
        expiresAt: input.expiresAt,
        completeAttempts: 0,
        cleanupAttempts: 0,
        cleanupCompletedAt: null,
        createdAt: input.now,
        availableAt: null,
        deletedAt: null,
      };
      records.set(record.id, record);
      return record;
    },
    async complete(
      input: CompleteAttachmentInput,
      verify: Parameters<AttachmentRepository['complete']>[1],
    ) {
      const record = records.get(input.id);
      if (
        !record ||
        record.tenantId !== input.tenantId ||
        record.ownerUserId !== input.ownerUserId
      ) {
        const error = new Error('not found');
        Object.assign(error, { status: 404 });
        throw error;
      }
      if (record.status !== 'uploaded') {
        const error = new Error('conflict');
        Object.assign(error, { status: 409 });
        throw error;
      }
      const attempt = record.completeAttempts + 1;
      const verification: AttachmentVerification =
        record.expiresAt <= input.now
          ? { kind: 'rejected', reason: 'UPLOAD_EXPIRED' }
          : await verify(record);
      record.completeAttempts = attempt;
      if (verification.kind === 'available') {
        record.status = 'available';
        record.sha256 = verification.sha256;
        record.availableAt = input.now;
        return {
          state: 'available',
          record,
          reason: null,
          cleanupRequired: false,
        };
      }
      const rejected = verification.kind === 'rejected' || attempt >= 3;
      if (rejected) record.status = 'rejected';
      return {
        state: rejected ? 'rejected' : 'retryable',
        record,
        reason: verification.reason,
        cleanupRequired: rejected,
      };
    },
    async findAvailable(input) {
      const record = records.get(input.id);
      if (
        !record ||
        record.tenantId !== input.tenantId ||
        record.status !== 'available'
      )
        return null;
      if (input.role === 'guardian' && record.ownerUserId !== input.ownerUserId)
        return null;
      return record;
    },
    async findRejectedForCleanup(input) {
      const record = records.get(input.id);
      if (
        !record ||
        record.tenantId !== input.tenantId ||
        record.status !== 'rejected' ||
        record.cleanupCompletedAt
      )
        return null;
      if (
        !['owner', 'admin', 'staff'].includes(input.role) &&
        record.ownerUserId !== input.ownerUserId
      )
        return null;
      return record;
    },
    async listExpiredUploaded(input: ExpiredAttachmentCleanupInput) {
      return [...records.values()].filter(
        (record) =>
          record.tenantId === input.tenantId &&
          record.status === 'uploaded' &&
          record.expiresAt <= input.now,
      );
    },
    async rejectExpired(input) {
      const record = records.get(input.id);
      if (
        !record ||
        record.tenantId !== input.tenantId ||
        record.status !== 'uploaded' ||
        record.expiresAt > input.now
      )
        return null;
      record.status = 'rejected';
      return record;
    },
    async recordCleanupAttempt(input) {
      const record = records.get(input.id);
      if (!record) return;
      record.cleanupAttempts += 1;
      if (input.completed) record.cleanupCompletedAt = new Date();
      cleanupAttempts.push({ ...input });
    },
  };
}

type TestOptions = {
  repository?: TestRepository;
  storage?: FakeAttachmentStorage;
  now?: () => Date;
  createId?: () => string;
};

function createTestApp(options: TestOptions = {}) {
  const repository = options.repository ?? createMemoryRepository();
  const clock = options.now ?? (() => new Date('2026-08-22T00:00:00.000Z'));
  const storage = options.storage ?? createFakeAttachmentStorage(clock);
  const app = createAttachmentApp({
    verifyToken: async (token) => {
      const user = USERS[token];
      if (!user) throw new Error('invalid token');
      return {
        userId: token,
        issuer: 'https://example.supabase.co/auth/v1',
        audience: 'authenticated',
        expiresAt: Math.floor(clock().getTime() / 1000) + 300,
      };
    },
    membershipRepository: {
      findActiveByUserId: async (userId) => USERS[userId] ?? null,
    },
    attachmentRepository: repository,
    storage,
    now: clock,
    createId:
      options.createId ?? (() => '01912345-6789-7abc-8def-0123456789ab'),
  });
  return { app, repository, storage };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function startUpload(
  app: ReturnType<typeof createAttachmentApp>,
  token = 'owner-a',
  input: unknown = { mediaType: 'image/png', byteSize: PNG.length },
) {
  return app.request('/api/v1/uploads', {
    method: 'POST',
    headers: { ...auth(token), 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('未認証、guardian、body内ownerUserIdを拒否する', async () => {
  const { app } = createTestApp();
  assert.equal((await app.request('/api/v1/uploads')).status, 401);
  assert.equal((await startUpload(app, 'guardian-a')).status, 403);
  assert.equal(
    (
      await startUpload(app, 'owner-a', {
        mediaType: 'image/png',
        byteSize: PNG.length,
        ownerUserId: 'owner-b',
      })
    ).status,
    400,
  );
});

test('同一テナント・所有者の署名PUTとcompleteだけをavailableにする', async () => {
  const { app, storage } = createTestApp();
  const start = await startUpload(app);
  assert.equal(start.status, 201);
  const session = await start.json();
  storage.put(session.uploadUrl, PNG, 'image/png');
  const complete = await app.request(
    `/api/v1/uploads/${session.attachmentId}/complete`,
    {
      method: 'POST',
      headers: { ...auth('owner-a'), 'content-type': 'application/json' },
      body: JSON.stringify({ sha256: sha256(PNG), byteSize: PNG.length }),
    },
  );
  assert.equal(complete.status, 200);
  assert.equal((await complete.json()).data.status, 'available');
  const download = await app.request(
    `/api/v1/uploads/${session.attachmentId}/download`,
    {
      headers: auth('owner-a'),
    },
  );
  assert.equal(download.status, 200);
});

test('別テナントと別所有者は添付の存在を推測できない', async () => {
  const { app, storage } = createTestApp();
  const start = await startUpload(app);
  const session = await start.json();
  storage.put(session.uploadUrl, PNG, 'image/png');
  const complete = await app.request(
    `/api/v1/uploads/${session.attachmentId}/complete`,
    {
      method: 'POST',
      headers: { ...auth('owner-b'), 'content-type': 'application/json' },
      body: JSON.stringify({ sha256: sha256(PNG), byteSize: PNG.length }),
    },
  );
  assert.equal(complete.status, 404);
});

test('magic bytesとSHA-256不一致はrejectedにして本体cleanupする', async () => {
  const { app, storage } = createTestApp();
  const start = await startUpload(app);
  const session = await start.json();
  storage.put(session.uploadUrl, new Uint8Array([1, 2, 3, 4]), 'image/png');
  const response = await app.request(
    `/api/v1/uploads/${session.attachmentId}/complete`,
    {
      method: 'POST',
      headers: { ...auth('owner-a'), 'content-type': 'application/json' },
      body: JSON.stringify({ sha256: sha256(PNG), byteSize: 4 }),
    },
  );
  assert.equal(response.status, 422);
  assert.deepEqual(storage.deletedObjectKeys, [
    session.attachmentId.replace(
      '01912345-6789-7abc-8def-0123456789ab',
      `${TENANT_A}/attachments/01912345-6789-7abc-8def-0123456789ab`,
    ),
  ]);
});

test('ストレージ未反映は2回再試行でき、3回目でrejectedにする', async () => {
  const { app, repository } = createTestApp();
  const start = await startUpload(app);
  const session = await start.json();
  for (const expected of [503, 503, 422]) {
    const response = await app.request(
      `/api/v1/uploads/${session.attachmentId}/complete`,
      {
        method: 'POST',
        headers: { ...auth('owner-a'), 'content-type': 'application/json' },
        body: JSON.stringify({ sha256: sha256(PNG), byteSize: PNG.length }),
      },
    );
    assert.equal(response.status, expected);
  }
  assert.equal(repository.records.get(session.attachmentId)?.status, 'rejected');
});

test('cleanup失敗は503で残し、cleanup endpointで再試行できる', async () => {
  const clock = () => new Date('2026-08-22T00:00:00.000Z');
  const base = createFakeAttachmentStorage(clock);
  let shouldFail = true;
  const storage: FakeAttachmentStorage = {
    ...base,
    async deleteObject(
      input: Parameters<FakeAttachmentStorage['deleteObject']>[0],
    ) {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('temporary cleanup failure');
      }
      return base.deleteObject(input);
    },
  };
  const { app } = createTestApp({ storage, now: clock });
  const start = await startUpload(app);
  const session = await start.json();
  storage.put(session.uploadUrl, new Uint8Array([1, 2, 3]), 'image/png');
  const complete = await app.request(
    `/api/v1/uploads/${session.attachmentId}/complete`,
    {
      method: 'POST',
      headers: { ...auth('owner-a'), 'content-type': 'application/json' },
      body: JSON.stringify({ sha256: sha256(PNG), byteSize: 3 }),
    },
  );
  assert.equal(complete.status, 503);
  const cleanup = await app.request(
    `/api/v1/uploads/${session.attachmentId}/cleanup`,
    {
      method: 'POST',
      headers: auth('owner-a'),
    },
  );
  assert.equal(cleanup.status, 200);
});

test('completeされずに期限切れになったセッションも一括cleanupできる', async () => {
  let current = new Date('2026-08-22T00:00:00.000Z');
  const clock = () => current;
  const { app, storage } = createTestApp({ now: clock });
  const start = await startUpload(app);
  const session = await start.json();
  storage.put(session.uploadUrl, PNG, 'image/png');
  current = new Date(current.getTime() + 901_000);
  const cleanup = await app.request('/api/v1/uploads/cleanup-expired', {
    method: 'POST',
    headers: auth('owner-a'),
  });
  assert.equal(cleanup.status, 200);
  assert.equal((await cleanup.json()).data.cleanedCount, 1);
  assert.deepEqual(storage.deletedObjectKeys, [
    `${TENANT_A}/attachments/${session.attachmentId}`,
  ]);
});
