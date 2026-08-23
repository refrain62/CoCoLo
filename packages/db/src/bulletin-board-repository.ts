import type {
  AnnouncementRecord,
  AnnouncementStatus,
  AnnouncementSummary,
  BulletinAttachmentMetadata,
  BulletinBoardRole,
  UnreadMember,
} from '@cocolo/domain/bulletin-board';
import { Prisma, type PrismaClient } from '@prisma/client';
import { uuidv7 } from './uuidv7.js';

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

type RepositoryActor = {
  tenantId: string;
  actorUserId: string;
  role: BulletinBoardRole;
};

export type BulletinBoardPublishInput = RepositoryActor & {
  title: string;
  body: string;
  attachmentIds: string[];
};

export type BulletinBoardListInput = {
  tenantId: string;
  userId: string;
  role: BulletinBoardRole;
  page: number;
  pageSize: number;
};

export type BulletinBoardReadInput = RepositoryActor & {
  announcementId: string;
  now?: Date;
};

export type BulletinBoardAttachmentLookup = (
  client: Prisma.TransactionClient,
  input: {
    tenantId: string;
    attachmentIds: string[];
  },
) => Promise<BulletinAttachmentMetadata[]>;

export type BulletinBoardRepository = {
  publish: (
    input: BulletinBoardPublishInput,
  ) => Promise<AnnouncementRecord & { isAuthor: boolean }>;
  list: (
    input: BulletinBoardListInput,
  ) => Promise<{ data: AnnouncementSummary[]; hasNext: boolean }>;
  find: (input: {
    tenantId: string;
    userId: string;
    role: BulletinBoardRole;
    announcementId: string;
  }) => Promise<(AnnouncementRecord & { isAuthor: boolean }) | null>;
  markRead: (input: BulletinBoardReadInput) => Promise<{ readAt: Date } | null>;
  listUnread: (input: BulletinBoardReadInput) => Promise<UnreadMember[] | null>;
};

export class BulletinBoardAttachmentNotFoundError extends Error {
  readonly status = 404;

  constructor() {
    // どのIDが不正かを返さず、別テナントや未公開添付の存在推測を防ぐ。
    super('指定された添付を利用できません。');
    this.name = 'BulletinBoardAttachmentNotFoundError';
  }
}

async function setRlsContext(
  client: DatabaseClient,
  input: { tenantId: string; userId: string; role: BulletinBoardRole },
) {
  await client.$queryRaw`
    SELECT
      set_config('app.tenant_id', ${input.tenantId}, true),
      set_config('app.user_id', ${input.userId}, true),
      set_config('app.role', ${input.role}, true),
      set_config('app.announcement_id', '', true)
  `;
}

async function setAnnouncementContext(
  client: Prisma.TransactionClient,
  announcementId: string,
) {
  await client.$executeRaw`
    SELECT set_config('app.announcement_id', ${announcementId}, true)
  `;
}

// 認証middlewareの結果をtransaction内で再確認し、所属停止との競合をfail-closedにする。
async function assertActiveMembership(
  client: Prisma.TransactionClient,
  input: RepositoryActor,
) {
  const rows = await client.$queryRaw<
    Array<{ role: BulletinBoardRole; status: string }>
  >`
    SELECT role, status
    FROM tenant_memberships
    WHERE tenant_id = ${input.tenantId}::uuid
      AND user_id = ${input.actorUserId}
  `;
  const membership = rows[0];
  if (membership?.status !== 'active' || membership.role !== input.role)
    throw new Error('有効な所属情報が処理中に変更されました。');
}

async function audit(
  client: Prisma.TransactionClient,
  input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  },
) {
  await client.$executeRaw`
    INSERT INTO audit_logs (
      id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata
    )
    VALUES (
      ${uuidv7()},
      ${input.tenantId}::uuid,
      ${input.actorUserId},
      ${input.action},
      'announcement',
      ${input.resourceId}::uuid,
      ${JSON.stringify(input.metadata)}::jsonb
    )
  `;
}

type AnnouncementRow = {
  id: string;
  tenant_id: string;
  author_user_id: string;
  title: string;
  body: string;
  status: AnnouncementStatus;
  published_at: Date;
  read_at: Date | null;
  is_author: boolean;
};

type AnnouncementSummaryRow = {
  id: string;
  title: string;
  status: AnnouncementStatus;
  published_at: Date;
  attachment_count: number;
  read_at: Date | null;
  is_author: boolean;
};

type AttachmentRow = BulletinAttachmentMetadata & {
  attachment_id: string;
};

type UnreadRow = {
  user_id: string;
  role: BulletinBoardRole;
};

function toAnnouncementRecord(
  row: AnnouncementRow,
  attachments: BulletinAttachmentMetadata[],
): AnnouncementRecord & { isAuthor: boolean } {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    authorUserId: row.author_user_id,
    title: row.title,
    body: row.body,
    status: row.status,
    publishedAt: row.published_at,
    attachments,
    readAt: row.read_at,
    isAuthor: row.is_author,
  };
}

function defaultAttachmentLookup(
  client: Prisma.TransactionClient,
  input: { tenantId: string; attachmentIds: string[] },
) {
  if (input.attachmentIds.length === 0)
    return Promise.resolve<BulletinAttachmentMetadata[]>([]);

  const ids = Prisma.join(
    input.attachmentIds.map((id) => Prisma.sql`${id}::uuid`),
  );
  return client.$queryRaw<
    Array<{
      id: string;
      media_type: BulletinAttachmentMetadata['mediaType'];
      byte_size: number;
    }>
  >`
    SELECT id, media_type, byte_size
    FROM attachments
    WHERE tenant_id = ${input.tenantId}::uuid
      AND id IN (${ids})
      AND status = 'available'::attachment_status
  `.then((rows) =>
    rows.map((row) => ({
      id: row.id,
      mediaType: row.media_type,
      byteSize: row.byte_size,
    })),
  );
}

async function loadAttachmentMetadata(
  client: Prisma.TransactionClient,
  input: { tenantId: string; attachmentIds: string[] },
  lookup: BulletinBoardAttachmentLookup,
) {
  if (new Set(input.attachmentIds).size !== input.attachmentIds.length)
    throw new BulletinBoardAttachmentNotFoundError();
  const found = await lookup(client, input);
  if (found.length !== input.attachmentIds.length)
    throw new BulletinBoardAttachmentNotFoundError();
  const byId = new Map(found.map((attachment) => [attachment.id, attachment]));
  const ordered = input.attachmentIds.map((id) => byId.get(id));
  if (ordered.some((attachment) => !attachment))
    throw new BulletinBoardAttachmentNotFoundError();
  return ordered as BulletinAttachmentMetadata[];
}

async function readAttachments(
  client: Prisma.TransactionClient,
  input: { tenantId: string; announcementId: string },
) {
  const rows = await client.$queryRaw<AttachmentRow[]>`
    SELECT
      attachment_id,
      media_type AS "mediaType",
      byte_size AS "byteSize"
    FROM announcement_attachments
    WHERE tenant_id = ${input.tenantId}::uuid
      AND announcement_id = ${input.announcementId}::uuid
    ORDER BY position ASC
  `;
  return rows.map((row) => ({
    id: row.attachment_id,
    mediaType: row.mediaType,
    byteSize: row.byteSize,
  }));
}

export function createBulletinBoardRepositories(
  client: PrismaClient,
  options: {
    attachmentLookup?: BulletinBoardAttachmentLookup;
    now?: () => Date;
    createId?: () => string;
  } = {},
): { bulletinBoardRepository: BulletinBoardRepository } {
  const lookup = options.attachmentLookup ?? defaultAttachmentLookup;
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? uuidv7;

  const bulletinBoardRepository: BulletinBoardRepository = {
    publish: (input) =>
      client.$transaction(async (tx) => {
        await setRlsContext(tx, {
          tenantId: input.tenantId,
          userId: input.actorUserId,
          role: input.role,
        });
        await assertActiveMembership(tx, input);
        const attachments = await loadAttachmentMetadata(
          tx,
          { tenantId: input.tenantId, attachmentIds: input.attachmentIds },
          lookup,
        );
        const publishedAt = now();
        const id = createId();
        const rows = await tx.$queryRaw<AnnouncementRow[]>`
          INSERT INTO announcements (
            id, tenant_id, author_user_id, title, body, status, published_at
          )
          VALUES (
            ${id}::uuid,
            ${input.tenantId}::uuid,
            ${input.actorUserId},
            ${input.title},
            ${input.body},
            'published'::announcement_status,
            ${publishedAt}
          )
          RETURNING
            id, tenant_id, author_user_id, title, body, status,
            published_at, NULL::timestamptz AS read_at,
            true AS is_author
        `;
        const row = rows[0];
        if (!row) throw new Error('回覧の掲載に失敗しました。');

        for (const [position, attachment] of attachments.entries())
          await tx.$executeRaw`
            INSERT INTO announcement_attachments (
              tenant_id, announcement_id, attachment_id, position,
              media_type, byte_size
            )
            VALUES (
              ${input.tenantId}::uuid,
              ${id}::uuid,
              ${attachment.id}::uuid,
              ${position},
              ${attachment.mediaType},
              ${attachment.byteSize}
            )
          `;

        await audit(tx, {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          action: 'announcement.published',
          resourceId: id,
          metadata: { attachmentCount: attachments.length },
        });
        return toAnnouncementRecord(row, attachments);
      }),

    list: (input) =>
      client.$transaction(async (tx) => {
        await setRlsContext(tx, {
          tenantId: input.tenantId,
          userId: input.userId,
          role: input.role,
        });
        await assertActiveMembership(tx, {
          tenantId: input.tenantId,
          actorUserId: input.userId,
          role: input.role,
        });
        const offset = (input.page - 1) * input.pageSize;
        const rows = await tx.$queryRaw<AnnouncementSummaryRow[]>`
          SELECT
            a.id,
            a.title,
            a.status,
            a.published_at,
            COUNT(aa.attachment_id)::int AS attachment_count,
            ar.read_at,
            (a.author_user_id = ${input.userId}) AS is_author
          FROM announcements AS a
          LEFT JOIN announcement_attachments AS aa
            ON aa.tenant_id = a.tenant_id
           AND aa.announcement_id = a.id
          LEFT JOIN announcement_reads AS ar
            ON ar.tenant_id = a.tenant_id
           AND ar.announcement_id = a.id
           AND ar.user_id = ${input.userId}
          WHERE a.tenant_id = ${input.tenantId}::uuid
            AND a.status = 'published'::announcement_status
          GROUP BY a.id, a.title, a.status, a.published_at, ar.read_at, a.author_user_id
          ORDER BY a.published_at DESC, a.id DESC
          OFFSET ${offset}
          LIMIT ${input.pageSize + 1}
        `;
        const hasNext = rows.length > input.pageSize;
        const data = rows.slice(0, input.pageSize).map((row) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          publishedAt: row.published_at,
          attachmentCount: row.attachment_count,
          readAt: row.read_at,
          isAuthor: row.is_author,
        }));
        return { data, hasNext };
      }),

    find: (input) =>
      client.$transaction(async (tx) => {
        await setRlsContext(tx, {
          tenantId: input.tenantId,
          userId: input.userId,
          role: input.role,
        });
        await assertActiveMembership(tx, {
          tenantId: input.tenantId,
          actorUserId: input.userId,
          role: input.role,
        });
        const rows = await tx.$queryRaw<AnnouncementRow[]>`
          SELECT
            a.id,
            a.tenant_id,
            a.author_user_id,
            a.title,
            a.body,
            a.status,
            a.published_at,
            ar.read_at,
            (a.author_user_id = ${input.userId}) AS is_author
          FROM announcements AS a
          LEFT JOIN announcement_reads AS ar
            ON ar.tenant_id = a.tenant_id
           AND ar.announcement_id = a.id
           AND ar.user_id = ${input.userId}
          WHERE a.tenant_id = ${input.tenantId}::uuid
            AND a.id = ${input.announcementId}::uuid
            AND a.status = 'published'::announcement_status
        `;
        const row = rows[0];
        if (!row) return null;
        return toAnnouncementRecord(
          row,
          await readAttachments(tx, {
            tenantId: input.tenantId,
            announcementId: input.announcementId,
          }),
        );
      }),

    markRead: (input) =>
      client.$transaction(async (tx) => {
        // 公開済み回覧はこのfeatureではappend-onlyにし、既読の複合PKとON CONFLICTで同時既読を直列化する。
        await setRlsContext(tx, {
          tenantId: input.tenantId,
          userId: input.actorUserId,
          role: input.role,
        });
        await assertActiveMembership(tx, input);
        const announcement = await tx.$queryRaw<
          Array<{ id: string; status: AnnouncementStatus }>
        >`
          SELECT id, status
          FROM announcements
          WHERE tenant_id = ${input.tenantId}::uuid
            AND id = ${input.announcementId}::uuid
            AND status = 'published'::announcement_status
        `;
        if (!announcement[0]) return null;
        const readAt = input.now ?? now();
        const inserted = await tx.$queryRaw<Array<{ read_at: Date }>>`
          INSERT INTO announcement_reads (
            tenant_id, announcement_id, user_id, read_at
          )
          VALUES (
            ${input.tenantId}::uuid,
            ${input.announcementId}::uuid,
            ${input.actorUserId},
            ${readAt}
          )
          ON CONFLICT (tenant_id, announcement_id, user_id) DO NOTHING
          RETURNING read_at
        `;
        if (inserted[0]) {
          await audit(tx, {
            tenantId: input.tenantId,
            actorUserId: input.actorUserId,
            action: 'announcement.read',
            resourceId: input.announcementId,
            metadata: {},
          });
          return { readAt: inserted[0].read_at };
        }
        const existing = await tx.$queryRaw<Array<{ read_at: Date }>>`
          SELECT read_at
          FROM announcement_reads
          WHERE tenant_id = ${input.tenantId}::uuid
            AND announcement_id = ${input.announcementId}::uuid
            AND user_id = ${input.actorUserId}
        `;
        return existing[0] ? { readAt: existing[0].read_at } : null;
      }),

    listUnread: (input) =>
      client.$transaction(async (tx) => {
        await setRlsContext(tx, {
          tenantId: input.tenantId,
          userId: input.actorUserId,
          role: input.role,
        });
        await assertActiveMembership(tx, input);
        const announcement = await tx.$queryRaw<
          Array<{ author_user_id: string; status: AnnouncementStatus }>
        >`
          SELECT author_user_id, status
          FROM announcements
          WHERE tenant_id = ${input.tenantId}::uuid
            AND id = ${input.announcementId}::uuid
            AND status = 'published'::announcement_status
        `;
        if (
          !announcement[0] ||
          announcement[0].author_user_id !== input.actorUserId
        )
          return null;

        await setAnnouncementContext(tx, input.announcementId);
        const rows = await tx.$queryRaw<UnreadRow[]>`
          SELECT tm.user_id, tm.role
          FROM tenant_memberships AS tm
          LEFT JOIN announcement_reads AS ar
            ON ar.tenant_id = tm.tenant_id
           AND ar.announcement_id = ${input.announcementId}::uuid
           AND ar.user_id = tm.user_id
          WHERE tm.tenant_id = ${input.tenantId}::uuid
            AND tm.status = 'active'::membership_status
            AND ar.user_id IS NULL
          ORDER BY tm.user_id ASC
        `;
        await audit(tx, {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          action: 'announcement.unread.viewed',
          resourceId: input.announcementId,
          metadata: { unreadCount: rows.length },
        });
        return rows.map((row) => ({ userId: row.user_id, role: row.role }));
      }),
  };

  return { bulletinBoardRepository };
}
