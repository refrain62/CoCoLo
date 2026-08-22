import { extractBearerToken, type TokenVerifier } from '@cocolo/auth';
import {
  attendanceUpsertSchema,
  eventCreateSchema,
  eventIdSchema,
  eventListQuerySchema,
  eventUpdateSchema,
} from '@cocolo/contracts/events';
import {
  EventAuthorizationError,
  type EventRepository,
} from '@cocolo/db/events';
import {
  AttendancePolicyError,
  type AttendanceResponse,
  canManageEvents,
  type EventRole,
  EventScheduleError,
  type EventType,
} from '@cocolo/domain/event';
import { type Context, Hono, type MiddlewareHandler } from 'hono';

type Membership = { tenantId: string; role: EventRole };

type EventCreateInput = {
  title: string;
  type: EventType;
  startsAt: string;
  endsAt: string;
  location?: string | null;
  itemsToBring?: string | null;
  fee: number;
  announcementImageAttachmentId?: string | null;
  opponent?: string | null;
  meetingTime?: string | null;
  transportationRequired: boolean;
  attendanceDeadline: string;
};

type EventUpdateInput = Partial<EventCreateInput>;

type EventApiOptions = {
  verifyToken?: TokenVerifier;
  membershipRepository: {
    findActiveByUserId: (userId: string) => Promise<Membership | null>;
  };
  eventRepository: EventRepository;
};

type EventApiEnv = {
  Variables: {
    requestId: string;
    auth: { userId: string; membership: Membership };
  };
};

function errorResponse(
  c: Context<EventApiEnv>,
  status: 400 | 401 | 403 | 404 | 409 | 500 | 503,
  code: string,
  message: string,
  details: unknown = {},
) {
  return c.json(
    {
      error: {
        code,
        message,
        details,
        requestId: c.get('requestId'),
      },
    },
    status,
  );
}

function inputError(c: Context<EventApiEnv>, error: unknown) {
  if (error instanceof EventScheduleError)
    return errorResponse(c, 400, 'VALIDATION_ERROR', error.message);
  if (error instanceof AttendancePolicyError) {
    if (error.code === 'DEADLINE_PASSED')
      return errorResponse(c, 409, 'ATTENDANCE_DEADLINE_PASSED', error.message);
    if (error.code === 'NOT_ASSIGNED')
      return errorResponse(c, 404, 'NOT_FOUND', '対象部員が見つかりません。');
    if (error.code === 'CORRECTION_REASON_REQUIRED')
      return errorResponse(c, 400, 'CORRECTION_REASON_REQUIRED', error.message);
    return errorResponse(c, 403, 'FORBIDDEN', error.message);
  }
  if (error instanceof EventAuthorizationError)
    return errorResponse(c, 403, 'FORBIDDEN', error.message);
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    error.status === 404
  )
    return errorResponse(c, 404, 'NOT_FOUND', '対象の予定が見つかりません。');
  return null;
}

function parseDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('日時が不正です。');
  return parsed;
}

function toEventWriteInput(input: EventCreateInput) {
  return {
    title: input.title,
    type: input.type,
    startsAt: parseDate(input.startsAt),
    endsAt: parseDate(input.endsAt),
    location: input.location ?? null,
    itemsToBring: input.itemsToBring ?? null,
    fee: input.fee,
    announcementImageAttachmentId: input.announcementImageAttachmentId ?? null,
    opponent: input.opponent ?? null,
    meetingTime: input.meetingTime ? parseDate(input.meetingTime) : null,
    transportationRequired: input.transportationRequired,
    attendanceDeadline: parseDate(input.attendanceDeadline),
  };
}

function toPartialEventWriteInput(input: EventUpdateInput) {
  const next: Record<string, unknown> = { ...input };
  if (input.startsAt) next.startsAt = parseDate(input.startsAt);
  if (input.endsAt) next.endsAt = parseDate(input.endsAt);
  if (input.meetingTime) next.meetingTime = parseDate(input.meetingTime);
  if (input.attendanceDeadline)
    next.attendanceDeadline = parseDate(input.attendanceDeadline);
  return next;
}

function projectEvent(
  event: Awaited<ReturnType<EventRepository['list']>>[number],
) {
  const { tenantId, ...publicEvent } = event;
  void tenantId;
  return publicEvent;
}

function projectAttendance(
  attendance: Awaited<ReturnType<EventRepository['upsertAttendance']>>,
) {
  return {
    eventId: attendance.eventId,
    memberId: attendance.memberId,
    response: attendance.response,
    updatedAt: attendance.updatedAt,
  };
}

// Phase 2の登録点をfeature単位へ閉じ込め、既存createAppへは統合メモ記載のapp.routeで接続する。
export function createEventsApp(options: EventApiOptions) {
  const app = new Hono<EventApiEnv>();
  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
    c.set('requestId', requestId);
    c.header('x-request-id', requestId);
    await next();
  });
  app.onError((error, c) => {
    const response = inputError(c, error);
    if (response) return response;
    return errorResponse(
      c,
      500,
      'INTERNAL_SERVER_ERROR',
      '予期しないエラーが発生しました。',
    );
  });

  const authenticate: MiddlewareHandler<EventApiEnv> = async (c, next) => {
    const token = extractBearerToken(c.req.header('authorization') ?? null);
    if (!options.verifyToken)
      return errorResponse(
        c,
        503,
        'AUTH_NOT_CONFIGURED',
        '認証・所属解決が設定されていません。',
      );
    if (!token)
      return errorResponse(c, 401, 'UNAUTHENTICATED', '認証が必要です。');
    try {
      const claims = await options.verifyToken(token);
      if (claims.expiresAt <= Math.floor(Date.now() / 1000))
        return errorResponse(
          c,
          401,
          'UNAUTHENTICATED',
          '認証の有効期限が切れています。',
        );
      const membership = await options.membershipRepository.findActiveByUserId(
        claims.userId,
      );
      if (!membership)
        return errorResponse(
          c,
          403,
          'FORBIDDEN',
          '利用可能な所属がありません。',
        );
      c.set('auth', { userId: claims.userId, membership });
      await next();
    } catch {
      return errorResponse(
        c,
        401,
        'UNAUTHENTICATED',
        '認証情報を確認できません。',
      );
    }
  };

  app.use('*', authenticate);

  app.get('/', async (c) => {
    const parsed = eventListQuerySchema.safeParse(c.req.query());
    if (!parsed.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        '期間指定が不正です。',
        parsed.error.flatten(),
      );
    const auth = c.get('auth');
    const events = await options.eventRepository.list({
      tenantId: auth.membership.tenantId,
      actorUserId: auth.userId,
      role: auth.membership.role,
      from: parseDate((parsed.data as { from: string }).from),
      to: parseDate((parsed.data as { to: string }).to),
    });
    return c.json({ data: events.map(projectEvent) });
  });

  app.post('/', async (c) => {
    const auth = c.get('auth');
    if (!canManageEvents(auth.membership.role))
      return errorResponse(
        c,
        403,
        'FORBIDDEN',
        '予定を登録する権限がありません。',
      );
    const body = await c.req.json().catch(() => null);
    const parsed = eventCreateSchema.safeParse(body);
    if (!parsed.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        '入力値が不正です。',
        parsed.error.flatten(),
      );
    const event = await options.eventRepository.create({
      tenantId: auth.membership.tenantId,
      actorUserId: auth.userId,
      role: auth.membership.role,
      ...toEventWriteInput(parsed.data as EventCreateInput),
    });
    return c.json({ data: projectEvent(event) }, 201);
  });

  app.patch('/:eventId', async (c) => {
    const auth = c.get('auth');
    if (!canManageEvents(auth.membership.role))
      return errorResponse(
        c,
        403,
        'FORBIDDEN',
        '予定を編集する権限がありません。',
      );
    const eventId = eventIdSchema.safeParse(c.req.param('eventId'));
    if (!eventId.success)
      return errorResponse(c, 404, 'NOT_FOUND', '対象の予定が見つかりません。');
    const body = await c.req.json().catch(() => null);
    const parsed = eventUpdateSchema.safeParse(body);
    if (!parsed.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        '入力値が不正です。',
        parsed.error.flatten(),
      );
    const event = await options.eventRepository.update({
      tenantId: auth.membership.tenantId,
      actorUserId: auth.userId,
      role: auth.membership.role,
      eventId: eventId.data as string,
      ...toPartialEventWriteInput(parsed.data as EventUpdateInput),
    });
    return c.json({ data: projectEvent(event) });
  });

  app.put('/:eventId/attendance', async (c) => {
    const auth = c.get('auth');
    const eventId = eventIdSchema.safeParse(c.req.param('eventId'));
    if (!eventId.success)
      return errorResponse(c, 404, 'NOT_FOUND', '対象の予定が見つかりません。');
    const body = await c.req.json().catch(() => null);
    const parsed = attendanceUpsertSchema.safeParse(body);
    if (!parsed.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        '入力値が不正です。',
        parsed.error.flatten(),
      );
    const input = parsed.data as {
      memberId: string;
      response: AttendanceResponse;
      correctionReason?: string;
    };
    const attendance = await options.eventRepository.upsertAttendance({
      tenantId: auth.membership.tenantId,
      actorUserId: auth.userId,
      role: auth.membership.role,
      eventId: eventId.data as string,
      ...input,
    });
    return c.json({ data: projectAttendance(attendance) });
  });

  app.get('/:eventId/attendance/summary', async (c) => {
    const auth = c.get('auth');
    const eventId = eventIdSchema.safeParse(c.req.param('eventId'));
    if (!eventId.success)
      return errorResponse(c, 404, 'NOT_FOUND', '対象の予定が見つかりません。');
    if (auth.membership.role === 'guardian')
      return errorResponse(
        c,
        403,
        'FORBIDDEN',
        '出欠集計を閲覧する権限がありません。',
      );
    const summary = await options.eventRepository.summary({
      tenantId: auth.membership.tenantId,
      actorUserId: auth.userId,
      role: auth.membership.role,
      eventId: eventId.data as string,
    });
    return c.json({ data: summary });
  });

  return app;
}

export type { EventApiOptions, Membership };
