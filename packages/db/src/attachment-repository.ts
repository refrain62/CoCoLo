import type {
  AttachmentRecord,
  AttachmentRepository,
  AttachmentStatus,
  CompleteAttachmentOutcome,
  CreateAttachmentSessionInput,
  ExpiredAttachmentCleanupInput,
} from '@cocolo/domain/attachment';
import { Prisma, type PrismaClient } from '@prisma/client';

type DatabaseClient = PrismaClient | Prisma.TransactionClient;
type AttachmentRole = 'owner' | 'admin' | 'staff' | 'guardian';

type AttachmentRow = {
  id: string;
  tenant_id: string;
  owner_user_id: string;
  object_key: string;
  media_type: 'image/jpeg' | 'image/png' | 'application/pdf';
  byte_size: number;
  sha256: string | null;
  status: AttachmentStatus;
  expires_at: Date;
  complete_attempts: number;
  cleanup_attempts: number;
  cleanup_completed_at: Date | null;
  created_at: Date;
  available_at: Date | null;
  deleted_at: Date | null;
};

export class AttachmentNotFoundError extends Error {
  readonly status = 404;

  constructor() {
    super('添付が見つかりません。');
    this.name = 'AttachmentNotFoundError';
  }
}

export class AttachmentConflictError extends Error {
  readonly status = 409;

  constructor(message = '添付セッションは再利用できません。') {
    super(message);
    this.name = 'AttachmentConflictError';
  }
}

async function setRlsContext(
  client: DatabaseClient,
  input: { tenantId: string; userId: string; role: AttachmentRole },
) {
  await client.$queryRaw`
    SELECT
      set_config('app.tenant_id', ${input.tenantId}, true),
      set_config('app.user_id', ${input.userId}, true),
      set_config('app.role', ${input.role}, true)
  `;
}

async function assertActiveMembership(
  client: DatabaseClient,
  input: { tenantId: string; userId: string; role: AttachmentRole },
) {
  const rows = await client.$queryRaw<
    Array<{ role: AttachmentRole; status: string }>
  >`
    SELECT role, status
    FROM tenant_memberships
    WHERE tenant_id = ${input.tenantId}::uuid
      AND user_id = ${input.userId}
  `;
  const membership = rows[0];
  if (membership?.status !== 'active' || membership.role !== input.role)
    throw new Error('有効な所属情報が処理中に変更されました。');
}

function toRecord(row: AttachmentRow): AttachmentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ownerUserId: row.owner_user_id,
    objectKey: row.object_key,
    mediaType: row.media_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    status: row.status,
    expiresAt: row.expires_at,
    completeAttempts: row.complete_attempts,
    cleanupAttempts: row.cleanup_attempts,
    cleanupCompletedAt: row.cleanup_completed_at,
    createdAt: row.created_at,
    availableAt: row.available_at,
    deletedAt: row.deleted_at,
  };
}

async function audit(
  client: DatabaseClient,
  input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  },
) {
  await client.$executeRaw`
    INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (
      gen_random_uuid(),
      ${input.tenantId}::uuid,
      ${input.actorUserId},
      ${input.action},
      'attachment',
      ${input.resourceId}::uuid,
      ${JSON.stringify(input.metadata)}::jsonb
    )
  `;
}

function recordSelectSql() {
  return Prisma.sql`
    id, tenant_id, owner_user_id, object_key, media_type, byte_size,
    sha256, status, expires_at, complete_attempts, cleanup_attempts,
    cleanup_completed_at, created_at, available_at, deleted_at
  `;
}

function accessSql(input: { ownerUserId: string; role: AttachmentRole }) {
  if (['owner', 'admin', 'staff'].includes(input.role)) return Prisma.sql``;
  return Prisma.sql`AND owner_user_id = ${input.ownerUserId}`;
}

// RLS contextと行ロックを同じtransactionへ閉じ込め、完了検証の競合で二重配信しない。
export function createAttachmentRepositories(client: PrismaClient): {
  attachmentRepository: AttachmentRepository;
} {
  const attachmentRepository: AttachmentRepository = {
    createSession: async (input: CreateAttachmentSessionInput) =>
      client.$transaction(async (tx) => {
        await setRlsContext(tx, {
          tenantId: input.tenantId,
          userId: input.ownerUserId,
          role: input.role,
        });
        await assertActiveMembership(tx, {
          tenantId: input.tenantId,
          userId: input.ownerUserId,
          role: input.role,
        });
        const rows = await tx.$queryRaw<AttachmentRow[]>`
          INSERT INTO attachments (
            id, tenant_id, owner_user_id, object_key, media_type,
            byte_size, expires_at, created_at
          )
          VALUES (
            ${input.id}::uuid,
            ${input.tenantId}::uuid,
            ${input.ownerUserId},
            ${input.objectKey},
            ${input.mediaType},
            ${input.byteSize},
            ${input.expiresAt},
            ${input.now}
          )
          RETURNING ${recordSelectSql()}
        `;
        const row = rows[0];
        if (!row) throw new Error('添付セッションの作成に失敗しました。');
        await audit(tx, {
          tenantId: input.tenantId,
          actorUserId: input.ownerUserId,
          action: 'attachment.upload.started',
          resourceId: input.id,
          metadata: { mediaType: input.mediaType, byteSize: input.byteSize },
        });
        return toRecord(row);
      }),

    complete: async (input, verify) =>
      client.$transaction(async (tx) => {
        await setRlsContext(tx, {
          tenantId: input.tenantId,
          userId: input.ownerUserId,
          role: input.role,
        });
        await assertActiveMembership(tx, {
          tenantId: input.tenantId,
          userId: input.ownerUserId,
          role: input.role,
        });
        const rows = await tx.$queryRaw<AttachmentRow[]>`
          SELECT ${recordSelectSql()}
          FROM attachments
          WHERE tenant_id = ${input.tenantId}::uuid
            AND owner_user_id = ${input.ownerUserId}
            AND id = ${input.id}::uuid
          FOR UPDATE
        `;
        const row = rows[0];
        if (!row) throw new AttachmentNotFoundError();
        if (row.status !== 'uploaded')
          throw new AttachmentConflictError(
            '添付セッションは完了済み、または拒否済みです。',
          );

        const record = toRecord(row);
        const attempt = record.completeAttempts + 1;
        const verification =
          record.expiresAt <= input.now
            ? { kind: 'rejected' as const, reason: 'UPLOAD_EXPIRED' }
            : await verify(record);

        if (verification.kind === 'available') {
          const updated = await tx.$queryRaw<AttachmentRow[]>`
            UPDATE attachments
            SET status = 'available'::attachment_status,
                sha256 = ${verification.sha256},
                complete_attempts = ${attempt},
                available_at = ${input.now}
            WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.id}::uuid
            RETURNING ${recordSelectSql()}
          `;
          const available = updated[0];
          if (!available)
            throw new Error('添付のavailable更新に失敗しました。');
          await audit(tx, {
            tenantId: input.tenantId,
            actorUserId: input.ownerUserId,
            action: 'attachment.upload.available',
            resourceId: input.id,
            metadata: { byteSize: verification.byteSize },
          });
          return {
            state: 'available',
            record: toRecord(available),
            reason: null,
            cleanupRequired: false,
          } satisfies CompleteAttachmentOutcome;
        }

        const shouldReject = verification.kind === 'rejected' || attempt >= 3;
        const updated = await tx.$queryRaw<AttachmentRow[]>`
          UPDATE attachments
          SET status = ${shouldReject ? 'rejected' : 'uploaded'}::attachment_status,
              complete_attempts = ${attempt}
          WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.id}::uuid
          RETURNING ${recordSelectSql()}
        `;
        const next = updated[0];
        if (!next) throw new Error('添付の検証状態更新に失敗しました。');
        await audit(tx, {
          tenantId: input.tenantId,
          actorUserId: input.ownerUserId,
          action: shouldReject
            ? 'attachment.upload.rejected'
            : 'attachment.upload.retryable',
          resourceId: input.id,
          metadata: {
            reason: verification.reason,
            attempt,
          },
        });
        return {
          state: shouldReject ? 'rejected' : 'retryable',
          record: toRecord(next),
          reason: verification.reason,
          cleanupRequired: shouldReject,
        } satisfies CompleteAttachmentOutcome;
      }),

    findAvailable: async (input) =>
      client.$transaction(async (tx) => {
        await setRlsContext(tx, {
          tenantId: input.tenantId,
          userId: input.ownerUserId,
          role: input.role,
        });
        await assertActiveMembership(tx, {
          tenantId: input.tenantId,
          userId: input.ownerUserId,
          role: input.role,
        });
        const rows = await tx.$queryRaw<AttachmentRow[]>`
          SELECT ${recordSelectSql()}
          FROM attachments
          WHERE tenant_id = ${input.tenantId}::uuid
            AND id = ${input.id}::uuid
            AND status = 'available'::attachment_status
            ${accessSql(input)}
        `;
        return rows[0] ? toRecord(rows[0]) : null;
      }),

    findRejectedForCleanup: async (input) =>
      client.$transaction(async (tx) => {
        await setRlsContext(tx, {
          tenantId: input.tenantId,
          userId: input.ownerUserId,
          role: input.role,
        });
        await assertActiveMembership(tx, {
          tenantId: input.tenantId,
          userId: input.ownerUserId,
          role: input.role,
        });
        const rows = await tx.$queryRaw<AttachmentRow[]>`
          SELECT ${recordSelectSql()}
          FROM attachments
          WHERE tenant_id = ${input.tenantId}::uuid
            AND id = ${input.id}::uuid
            AND status = 'rejected'::attachment_status
            AND cleanup_completed_at IS NULL
            ${accessSql(input)}
          FOR UPDATE
        `;
        return rows[0] ? toRecord(rows[0]) : null;
      }),

    listExpiredUploaded: async (input: ExpiredAttachmentCleanupInput) =>
      client.$transaction(async (tx) => {
        await setRlsContext(tx, {
          tenantId: input.tenantId,
          userId: input.actorUserId,
          role: input.role,
        });
        await assertActiveMembership(tx, {
          tenantId: input.tenantId,
          userId: input.actorUserId,
          role: input.role,
        });
        const rows = await tx.$queryRaw<AttachmentRow[]>`
          SELECT ${recordSelectSql()}
          FROM attachments
          WHERE tenant_id = ${input.tenantId}::uuid
            AND status = 'uploaded'::attachment_status
            AND expires_at <= ${input.now}
          ORDER BY expires_at, id
          LIMIT ${input.limit}
        `;
        return rows.map(toRecord);
      }),

    rejectExpired: async (input) =>
      client.$transaction(async (tx) => {
        await setRlsContext(tx, {
          tenantId: input.tenantId,
          userId: input.actorUserId,
          role: input.role,
        });
        await assertActiveMembership(tx, {
          tenantId: input.tenantId,
          userId: input.actorUserId,
          role: input.role,
        });
        const rows = await tx.$queryRaw<AttachmentRow[]>`
          SELECT ${recordSelectSql()}
          FROM attachments
          WHERE tenant_id = ${input.tenantId}::uuid
            AND id = ${input.id}::uuid
            AND status = 'uploaded'::attachment_status
            AND expires_at <= ${input.now}
          FOR UPDATE
        `;
        const row = rows[0];
        if (!row) return null;
        const updated = await tx.$queryRaw<AttachmentRow[]>`
          UPDATE attachments
          SET status = 'rejected'::attachment_status
          WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.id}::uuid
          RETURNING ${recordSelectSql()}
        `;
        const rejected = updated[0];
        if (!rejected) return null;
        await audit(tx, {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          action: 'attachment.upload.expired',
          resourceId: input.id,
          metadata: { reason: 'UPLOAD_EXPIRED' },
        });
        return toRecord(rejected);
      }),

    recordCleanupAttempt: async (input) =>
      client.$transaction(async (tx) => {
        await setRlsContext(tx, {
          tenantId: input.tenantId,
          userId: input.ownerUserId,
          role: input.role,
        });
        await assertActiveMembership(tx, {
          tenantId: input.tenantId,
          userId: input.ownerUserId,
          role: input.role,
        });
        await tx.$executeRaw`
          UPDATE attachments
          SET cleanup_attempts = cleanup_attempts + 1,
              cleanup_completed_at = CASE
                WHEN ${input.completed} THEN now()
                ELSE cleanup_completed_at
              END
          WHERE tenant_id = ${input.tenantId}::uuid
            AND id = ${input.id}::uuid
            AND owner_user_id = ${input.ownerUserId}
            AND status = 'rejected'::attachment_status
        `;
      }),
  };

  return { attachmentRepository };
}
