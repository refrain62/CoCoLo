import { randomBytes } from 'node:crypto';
import {
  type AttendanceResponse,
  assertAttendanceChangeAllowed,
  assertValidEventSchedule,
  type EventRole,
  type EventType,
  summarizeAttendance,
} from '@cocolo/domain/event';
import type { Prisma, PrismaClient } from '@prisma/client';

export type EventRecord = {
  id: string;
  tenantId: string;
  title: string;
  type: EventType;
  startsAt: string;
  endsAt: string;
  location: string | null;
  itemsToBring: string | null;
  fee: number;
  announcementImageAttachmentId: string | null;
  opponent: string | null;
  meetingTime: string | null;
  transportationRequired: boolean;
  attendanceDeadline: string;
  createdAt: string;
  updatedAt: string;
};

export type AttendanceRecord = {
  id: string;
  eventId: string;
  userId: string;
  memberId: string;
  response: AttendanceResponse;
  correctionReason: string | null;
  respondedAt: string;
  updatedAt: string;
};

export type AttendanceSummary = ReturnType<typeof summarizeAttendance> & {
  totalMembers: number;
  unansweredMemberIds: string[];
};

export type EventRepositoryInput = {
  tenantId: string;
  actorUserId: string;
  role: EventRole;
};

export class EventNotFoundError extends Error {
  readonly status = 404;

  constructor(message = '予定が見つかりません。') {
    super(message);
    this.name = 'EventNotFoundError';
  }
}

export class EventAuthorizationError extends Error {
  readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = 'EventAuthorizationError';
  }
}

export type EventRepository = {
  list: (
    input: EventRepositoryInput & { from: Date; to: Date },
  ) => Promise<EventRecord[]>;
  create: (
    input: EventRepositoryInput & EventWriteInput,
  ) => Promise<EventRecord>;
  update: (
    input: EventRepositoryInput & {
      eventId: string;
    } & Partial<EventWriteInput>,
  ) => Promise<EventRecord>;
  upsertAttendance: (
    input: EventRepositoryInput & {
      eventId: string;
      memberId: string;
      response: AttendanceResponse;
      correctionReason?: string | null;
    },
  ) => Promise<AttendanceRecord>;
  summary: (
    input: EventRepositoryInput & { eventId: string },
  ) => Promise<AttendanceSummary>;
};

export type EventWriteInput = {
  title: string;
  type: EventType;
  startsAt: Date;
  endsAt: Date;
  location?: string | null;
  itemsToBring?: string | null;
  fee: number;
  announcementImageAttachmentId?: string | null;
  opponent?: string | null;
  meetingTime?: Date | null;
  transportationRequired: boolean;
  attendanceDeadline: Date;
};

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

type EventRow = {
  id: string;
  tenant_id: string;
  title: string;
  event_type: EventType;
  starts_at: Date;
  ends_at: Date;
  location: string | null;
  items_to_bring: string | null;
  fee: number;
  announcement_image_attachment_id: string | null;
  opponent: string | null;
  meeting_time: Date | null;
  transportation_required: boolean;
  attendance_deadline: Date;
  created_at: Date;
  updated_at: Date;
};

type AttendanceRow = {
  id: string;
  event_id: string;
  user_id: string;
  member_id: string;
  response: AttendanceResponse;
  correction_reason: string | null;
  responded_at: Date;
  updated_at: Date;
};

function uuidV7() {
  const bytes = randomBytes(16);
  const timestamp = BigInt(Date.now());
  for (let index = 5; index >= 0; index -= 1)
    bytes[index] = Number((timestamp >> BigInt((5 - index) * 8)) & 0xffn);
  const byte6 = bytes[6];
  const byte8 = bytes[8];
  if (byte6 === undefined || byte8 === undefined)
    throw new Error('UUIDv7の乱数領域を確保できませんでした。');
  bytes[6] = (byte6 & 0x0f) | 0x70;
  bytes[8] = (byte8 & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// transaction-localなRLS contextを毎回設定し、connection pool再利用時のtenant残留を防ぐ。
async function setRlsContext(
  client: DatabaseClient,
  input: EventRepositoryInput,
) {
  await client.$queryRaw`
    SELECT
      set_config('app.tenant_id', ${input.tenantId}, true),
      set_config('app.user_id', ${input.actorUserId}, true),
      set_config('app.role', ${input.role}, true)
  `;
}

async function assertActiveMembership(
  client: Prisma.TransactionClient,
  input: EventRepositoryInput,
) {
  const membershipLockKey = `${input.tenantId}:${input.actorUserId}`;
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${membershipLockKey}, 0))
  `;
  const memberships = await client.$queryRaw<
    Array<{ role: string; status: string }>
  >`
    SELECT role::text, status::text
    FROM tenant_memberships
    WHERE tenant_id = ${input.tenantId}::uuid
      AND user_id = ${input.actorUserId}
    FOR UPDATE
  `;
  const membership = memberships[0];
  if (membership?.status !== 'active' || membership.role !== input.role)
    throw new Error('有効な所属情報が処理中に変更されました。');
}

async function assertAvailableAttachment(
  client: Prisma.TransactionClient,
  input: EventRepositoryInput,
  attachmentId: string | null | undefined,
) {
  if (!attachmentId) return;
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM attachments
    WHERE tenant_id = ${input.tenantId}::uuid
      AND id = ${attachmentId}::uuid
      AND status = 'available'::attachment_status
  `;
  if (!rows[0])
    throw new EventNotFoundError('利用可能な添付が見つかりません。');
}

function toEventRecord(row: EventRow): EventRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    type: row.event_type,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    location: row.location,
    itemsToBring: row.items_to_bring,
    fee: row.fee,
    announcementImageAttachmentId: row.announcement_image_attachment_id,
    opponent: row.opponent,
    meetingTime: row.meeting_time?.toISOString() ?? null,
    transportationRequired: row.transportation_required,
    attendanceDeadline: row.attendance_deadline.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toAttendanceRecord(row: AttendanceRow): AttendanceRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    userId: row.user_id,
    memberId: row.member_id,
    response: row.response,
    correctionReason: row.correction_reason,
    respondedAt: row.responded_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function audit(
  client: Prisma.TransactionClient,
  input: EventRepositoryInput,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Prisma.InputJsonValue,
) {
  await client.$executeRaw`
    INSERT INTO audit_logs (
      id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata
    ) VALUES (
      ${uuidV7()}::uuid, ${input.tenantId}::uuid, ${input.actorUserId},
      ${action}, ${resourceType}, ${resourceId}::uuid,
      ${JSON.stringify(metadata)}::jsonb
    )
  `;
}

async function findAssignedMember(
  client: Prisma.TransactionClient,
  input: EventRepositoryInput,
  memberId: string,
) {
  if (input.role !== 'guardian') return true;
  const rows = await client.$queryRaw<Array<{ member_id: string }>>`
    SELECT member_id
    FROM guardian_members
    WHERE tenant_id = ${input.tenantId}::uuid
      AND user_id = ${input.actorUserId}
      AND member_id = ${memberId}::uuid
    LIMIT 1
    FOR SHARE
  `;
  return rows.length > 0;
}

// イベントと回答を同一transactionで更新し、締切判定・担当部員・監査をDB境界内で確定する。
export function createEventRepository(client: PrismaClient): EventRepository {
  return {
    list: (input) =>
      client.$transaction(async (tx) => {
        await setRlsContext(tx, input);
        await assertActiveMembership(tx, input);
        const rows = await tx.$queryRaw<EventRow[]>`
          SELECT id, tenant_id, title, event_type, starts_at, ends_at,
                 location, items_to_bring, fee, announcement_image_attachment_id,
                 opponent, meeting_time, transportation_required,
                 attendance_deadline, created_at, updated_at
          FROM events
          WHERE tenant_id = ${input.tenantId}::uuid
            AND starts_at < ${input.to}
            AND ends_at > ${input.from}
          ORDER BY starts_at ASC, id ASC
          LIMIT 500
        `;
        await audit(tx, input, 'event.list', 'event', input.tenantId, {
          from: input.from.toISOString(),
          to: input.to.toISOString(),
        });
        return rows.map(toEventRecord);
      }),
    create: (input) =>
      client.$transaction(async (tx) => {
        await setRlsContext(tx, input);
        await assertActiveMembership(tx, input);
        if (!['owner', 'admin', 'staff'].includes(input.role))
          throw new EventAuthorizationError('予定を登録する権限がありません。');
        assertValidEventSchedule(input, input.type, input.opponent);
        await assertAvailableAttachment(
          tx,
          input,
          input.announcementImageAttachmentId,
        );
        const id = uuidV7();
        const rows = await tx.$queryRaw<EventRow[]>`
          INSERT INTO events (
            id, tenant_id, title, event_type, starts_at, ends_at, location,
            items_to_bring, fee, announcement_image_attachment_id, opponent,
            meeting_time, transportation_required, attendance_deadline,
            created_by_user_id, updated_by_user_id
          ) VALUES (
            ${id}::uuid, ${input.tenantId}::uuid, ${input.title}, ${input.type}::event_type,
            ${input.startsAt}, ${input.endsAt}, ${input.location ?? null},
            ${input.itemsToBring ?? null}, ${input.fee},
            ${input.announcementImageAttachmentId ?? null}::uuid,
            ${input.opponent ?? null}, ${input.meetingTime ?? null},
            ${input.transportationRequired}, ${input.attendanceDeadline},
            ${input.actorUserId}, ${input.actorUserId}
          )
          RETURNING id, tenant_id, title, event_type, starts_at, ends_at,
                    location, items_to_bring, fee, announcement_image_attachment_id,
                    opponent, meeting_time, transportation_required,
                    attendance_deadline, created_at, updated_at
        `;
        const row = rows[0];
        if (!row)
          throw new EventNotFoundError(
            '予定の登録結果を取得できませんでした。',
          );
        await audit(tx, input, 'event.create', 'event', id, {
          type: input.type,
          startsAt: input.startsAt.toISOString(),
        });
        return toEventRecord(row);
      }),
    update: (input) =>
      client.$transaction(async (tx) => {
        await setRlsContext(tx, input);
        await assertActiveMembership(tx, input);
        if (!['owner', 'admin', 'staff'].includes(input.role))
          throw new EventAuthorizationError('予定を編集する権限がありません。');
        const currentRows = await tx.$queryRaw<EventRow[]>`
          SELECT id, tenant_id, title, event_type, starts_at, ends_at,
                 location, items_to_bring, fee, announcement_image_attachment_id,
                 opponent, meeting_time, transportation_required,
                 attendance_deadline, created_at, updated_at
          FROM events
          WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.eventId}::uuid
          FOR UPDATE
        `;
        const current = currentRows[0];
        if (!current) throw new EventNotFoundError();
        const next = {
          title: input.title ?? current.title,
          type: input.type ?? current.event_type,
          startsAt: input.startsAt ?? current.starts_at,
          endsAt: input.endsAt ?? current.ends_at,
          location:
            input.location === undefined ? current.location : input.location,
          itemsToBring:
            input.itemsToBring === undefined
              ? current.items_to_bring
              : input.itemsToBring,
          fee: input.fee ?? current.fee,
          announcementImageAttachmentId:
            input.announcementImageAttachmentId === undefined
              ? current.announcement_image_attachment_id
              : input.announcementImageAttachmentId,
          opponent:
            input.opponent === undefined ? current.opponent : input.opponent,
          meetingTime:
            input.meetingTime === undefined
              ? current.meeting_time
              : input.meetingTime,
          transportationRequired:
            input.transportationRequired ?? current.transportation_required,
          attendanceDeadline:
            input.attendanceDeadline ?? current.attendance_deadline,
        };
        assertValidEventSchedule(next, next.type, next.opponent);
        await assertAvailableAttachment(
          tx,
          input,
          next.announcementImageAttachmentId,
        );
        const rows = await tx.$queryRaw<EventRow[]>`
          UPDATE events SET
            title = ${next.title}, event_type = ${next.type}::event_type,
            starts_at = ${next.startsAt}, ends_at = ${next.endsAt},
            location = ${next.location}, items_to_bring = ${next.itemsToBring},
            fee = ${next.fee}, announcement_image_attachment_id = ${next.announcementImageAttachmentId}::uuid,
            opponent = ${next.opponent}, meeting_time = ${next.meetingTime},
            transportation_required = ${next.transportationRequired},
            attendance_deadline = ${next.attendanceDeadline},
            updated_by_user_id = ${input.actorUserId}, updated_at = now()
          WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.eventId}::uuid
          RETURNING id, tenant_id, title, event_type, starts_at, ends_at,
                    location, items_to_bring, fee, announcement_image_attachment_id,
                    opponent, meeting_time, transportation_required,
                    attendance_deadline, created_at, updated_at
        `;
        const row = rows[0];
        if (!row)
          throw new EventNotFoundError(
            '予定の更新結果を取得できませんでした。',
          );
        await audit(tx, input, 'event.update', 'event', input.eventId, {
          fields: Object.keys(input).filter(
            (key) =>
              key !== 'tenantId' &&
              key !== 'actorUserId' &&
              key !== 'role' &&
              key !== 'eventId',
          ),
        });
        return toEventRecord(row);
      }),
    upsertAttendance: (input) =>
      client.$transaction(async (tx) => {
        await setRlsContext(tx, input);
        await assertActiveMembership(tx, input);
        const eventRows = await tx.$queryRaw<
          Array<{ attendance_deadline: Date }>
        >`
          SELECT attendance_deadline
          FROM events
          WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.eventId}::uuid
          FOR UPDATE
        `;
        const event = eventRows[0];
        if (!event) throw new EventNotFoundError();
        const memberRows = await tx.$queryRaw<Array<{ status: string }>>`
          SELECT status
          FROM members
          WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.memberId}::uuid
        `;
        if (!memberRows[0] || memberRows[0].status === 'retired')
          throw new EventNotFoundError('対象部員が見つかりません。');
        const isAssignedMember = await findAssignedMember(
          tx,
          input,
          input.memberId,
        );
        const deadlineRows = await tx.$queryRaw<Array<{ passed: boolean }>>`
          SELECT now() >= ${event.attendance_deadline} AS passed
        `;
        const deadlinePassed = deadlineRows[0]?.passed === true;
        assertAttendanceChangeAllowed({
          role: input.role,
          isAssignedMember,
          deadlinePassed,
          correctionReason: input.correctionReason,
        });
        const existingRows = await tx.$queryRaw<AttendanceRow[]>`
          SELECT id, event_id, user_id, member_id, response, correction_reason,
                 responded_at, updated_at
          FROM attendance_responses
          WHERE tenant_id = ${input.tenantId}::uuid
            AND event_id = ${input.eventId}::uuid
            AND member_id = ${input.memberId}::uuid
            AND (
              (${input.role} = 'guardian' AND user_id = ${input.actorUserId})
              OR ${input.role} <> 'guardian'
            )
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
          FOR UPDATE
        `;
        const existing = existingRows[0];
        const responseUserId = existing?.user_id ?? input.actorUserId;
        let rows: AttendanceRow[];
        if (existing) {
          rows = await tx.$queryRaw<AttendanceRow[]>`
            UPDATE attendance_responses SET
              response = ${input.response}::attendance_response,
              correction_reason = ${deadlinePassed ? (input.correctionReason?.trim() ?? null) : null},
              updated_at = now()
            WHERE id = ${existing.id}::uuid
            RETURNING id, event_id, user_id, member_id, response, correction_reason,
                      responded_at, updated_at
          `;
        } else {
          rows = await tx.$queryRaw<AttendanceRow[]>`
            INSERT INTO attendance_responses (
              id, tenant_id, event_id, user_id, member_id, response, correction_reason
            ) VALUES (
              ${uuidV7()}::uuid, ${input.tenantId}::uuid, ${input.eventId}::uuid,
              ${responseUserId}, ${input.memberId}::uuid, ${input.response}::attendance_response,
              ${deadlinePassed ? (input.correctionReason?.trim() ?? null) : null}
            )
            RETURNING id, event_id, user_id, member_id, response, correction_reason,
                      responded_at, updated_at
          `;
        }
        const row = rows[0];
        if (!row) throw new Error('出欠回答の保存結果を取得できませんでした。');
        await audit(
          tx,
          input,
          deadlinePassed ? 'attendance.correct' : 'attendance.upsert',
          'attendance_response',
          row.id,
          {
            eventId: input.eventId,
            memberId: input.memberId,
            response: input.response,
            correctionReason: deadlinePassed
              ? input.correctionReason?.trim()
              : null,
          },
        );
        return toAttendanceRecord(row);
      }),
    summary: (input) =>
      client.$transaction(async (tx) => {
        await setRlsContext(tx, input);
        await assertActiveMembership(tx, input);
        if (input.role === 'guardian')
          throw new EventAuthorizationError(
            '出欠集計を閲覧する権限がありません。',
          );
        const eventRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM events
          WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.eventId}::uuid
          FOR UPDATE
        `;
        if (!eventRows[0]) throw new EventNotFoundError();
        const totalRows = await tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*)::bigint AS count
          FROM members
          WHERE tenant_id = ${input.tenantId}::uuid AND status <> 'retired'::member_status
        `;
        const responseRows = await tx.$queryRaw<
          Array<{
            response: AttendanceResponse;
            member_id: string;
            updated_at: Date;
            id: string;
          }>
        >`
          SELECT id, response, member_id, updated_at
          FROM attendance_responses
          WHERE tenant_id = ${input.tenantId}::uuid AND event_id = ${input.eventId}::uuid
          ORDER BY member_id, updated_at DESC, id DESC
        `;
        const totalMembers = Number(totalRows[0]?.count ?? 0n);
        const latestResponses = new Map<string, AttendanceResponse>();
        for (const row of responseRows)
          if (!latestResponses.has(row.member_id))
            latestResponses.set(row.member_id, row.response);
        const counts = summarizeAttendance(totalMembers, [
          ...latestResponses.values(),
        ]);
        const answeredIds = new Set(latestResponses.keys());
        const memberRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM members
          WHERE tenant_id = ${input.tenantId}::uuid AND status <> 'retired'::member_status
          ORDER BY id
        `;
        await audit(
          tx,
          input,
          'attendance.summary',
          'event',
          input.eventId,
          {},
        );
        return {
          ...counts,
          totalMembers,
          unansweredMemberIds: memberRows
            .map((row) => row.id)
            .filter((id) => !answeredIds.has(id)),
        };
      }),
  };
}
