import { extractBearerToken, type TokenVerifier } from '@cocolo/auth';
import type { AnnouncementCreateInput } from '@cocolo/contracts/bulletin-board';
import {
  announcementCreateSchema,
  announcementIdSchema,
  announcementListQuerySchema,
} from '@cocolo/contracts/bulletin-board';
import type { BulletinBoardRepository } from '@cocolo/db/bulletin-board';
import type {
  AnnouncementRecord,
  AnnouncementSummary,
  BulletinBoardRole,
  UnreadMember,
} from '@cocolo/domain/bulletin-board';
import { canPublishAnnouncement } from '@cocolo/domain/bulletin-board';
import { type Context, Hono, type MiddlewareHandler } from 'hono';

export type BulletinBoardMembershipContext = {
  tenantId: string;
  role: BulletinBoardRole;
};

export type BulletinBoardMembershipRepository = {
  findActiveByUserId: (
    userId: string,
  ) => Promise<BulletinBoardMembershipContext | null>;
};

export type BulletinBoardAppOptions = {
  verifyToken?: TokenVerifier;
  membershipRepository?: BulletinBoardMembershipRepository;
  bulletinBoardRepository?: BulletinBoardRepository;
};

type ApiEnv = {
  Variables: {
    requestId: string;
    auth: {
      userId: string;
      membership: BulletinBoardMembershipContext;
    };
  };
};

type BulletinAttachmentDto = {
  id: string;
  mediaType: BulletinAttachmentMetadataType;
  byteSize: number;
};

type BulletinAttachmentMetadataType =
  | 'image/jpeg'
  | 'image/png'
  | 'application/pdf';

type AnnouncementSummaryDto = {
  id: string;
  title: string;
  status: 'published' | 'archived';
  publishedAt: string;
  attachmentCount: number;
  readAt: string | null;
  isRead: boolean;
  isAuthor: boolean;
};

type AnnouncementDto = AnnouncementSummaryDto & {
  body: string;
  attachments: BulletinAttachmentDto[];
  canViewUnread: boolean;
};

const roles = new Set<BulletinBoardRole>([
  'owner',
  'admin',
  'staff',
  'guardian',
]);

function asIsoDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function projectSummary(
  announcement: AnnouncementSummary,
): AnnouncementSummaryDto {
  const readAt = announcement.readAt ? asIsoDate(announcement.readAt) : null;
  return {
    id: announcement.id,
    title: announcement.title,
    status: announcement.status,
    publishedAt: asIsoDate(announcement.publishedAt),
    attachmentCount: announcement.attachmentCount,
    readAt,
    isRead: readAt !== null,
    isAuthor: announcement.isAuthor,
  };
}

function projectAnnouncement(
  announcement: AnnouncementRecord & { isAuthor: boolean },
): AnnouncementDto {
  const readAt = announcement.readAt ? asIsoDate(announcement.readAt) : null;
  return {
    id: announcement.id,
    title: announcement.title,
    body: announcement.body,
    status: announcement.status,
    publishedAt: asIsoDate(announcement.publishedAt),
    attachmentCount: announcement.attachments.length,
    readAt,
    isRead: readAt !== null,
    isAuthor: announcement.isAuthor,
    canViewUnread: announcement.isAuthor,
    attachments: announcement.attachments.map((attachment) => ({
      id: attachment.id,
      mediaType: attachment.mediaType,
      byteSize: attachment.byteSize,
    })),
  };
}

// 内部例外と個別の存在情報を外部へ返さず、feature単位でも共通エラー形式を維持する。
function errorResponse(
  c: Context<ApiEnv>,
  status: 400 | 401 | 403 | 404 | 500 | 503,
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

function hasStatus(error: unknown, status: number): boolean {
  return (
    error instanceof Error &&
    'status' in error &&
    (error as Error & { status?: unknown }).status === status
  );
}

async function readJsonBody(c: Context<ApiEnv>) {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

function parseAnnouncementId(c: Context<ApiEnv>) {
  const parsed = announcementIdSchema.safeParse(c.req.param('announcementId'));
  return parsed.success ? parsed.data : null;
}

// 回覧板だけを後から中央appへ接続できるよう、認証・route・repositoryをfeature adapterへ閉じ込める。
export function createBulletinBoardApp(options: BulletinBoardAppOptions = {}) {
  const app = new Hono<ApiEnv>();

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
    c.set('requestId', requestId);
    c.header('x-request-id', requestId);
    await next();
  });

  app.onError((error, c) => {
    void error;
    return errorResponse(
      c,
      500,
      'INTERNAL_SERVER_ERROR',
      '予期しないエラーが発生しました。',
    );
  });

  app.get('/health', (c) =>
    c.json({ status: 'ok', feature: 'bulletin-board' }),
  );

  // JWTだけでなく、後続repositoryへ渡すactive membershipも認証middlewareで確定する。
  const authenticate: MiddlewareHandler<ApiEnv> = async (c, next) => {
    const token = extractBearerToken(c.req.header('authorization') ?? null);
    if (!options.verifyToken || !options.membershipRepository)
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
      if (!membership || !roles.has(membership.role))
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

  app.use('/api/v1/announcements', authenticate);
  app.use('/api/v1/announcements/*', authenticate);

  app.get('/api/v1/announcements', async (c) => {
    if (!options.bulletinBoardRepository)
      return errorResponse(
        c,
        503,
        'DEPENDENCY_UNAVAILABLE',
        '回覧板データストアが設定されていません。',
      );
    const parsed = announcementListQuerySchema.safeParse(c.req.query());
    if (!parsed.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        '入力値が不正です。',
        parsed.error.flatten(),
      );
    const auth = c.get('auth');
    const result = await options.bulletinBoardRepository.list({
      tenantId: auth.membership.tenantId,
      userId: auth.userId,
      role: auth.membership.role,
      ...parsed.data,
    });
    return c.json({
      data: result.data.map(projectSummary),
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      hasNext: result.hasNext,
    });
  });

  app.post('/api/v1/announcements', async (c) => {
    if (!options.bulletinBoardRepository)
      return errorResponse(
        c,
        503,
        'DEPENDENCY_UNAVAILABLE',
        '回覧板データストアが設定されていません。',
      );
    const auth = c.get('auth');
    if (!canPublishAnnouncement(auth.membership.role))
      return errorResponse(
        c,
        403,
        'FORBIDDEN',
        '回覧を掲載する権限がありません。',
      );
    const body = await readJsonBody(c);
    const parsed = announcementCreateSchema.safeParse(body);
    if (!parsed.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        '入力値が不正です。',
        parsed.error.flatten(),
      );
    try {
      const announcement = await options.bulletinBoardRepository.publish({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
        ...(parsed.data satisfies AnnouncementCreateInput),
      });
      return c.json({ data: projectAnnouncement(announcement) }, 201);
    } catch (error) {
      if (hasStatus(error, 404))
        return errorResponse(
          c,
          404,
          'ATTACHMENT_NOT_FOUND',
          '指定された添付を利用できません。',
        );
      throw error;
    }
  });

  app.get('/api/v1/announcements/:announcementId', async (c) => {
    if (!options.bulletinBoardRepository)
      return errorResponse(
        c,
        503,
        'DEPENDENCY_UNAVAILABLE',
        '回覧板データストアが設定されていません。',
      );
    const announcementId = parseAnnouncementId(c);
    if (!announcementId)
      return errorResponse(
        c,
        404,
        'ANNOUNCEMENT_NOT_FOUND',
        '回覧が見つかりません。',
      );
    const auth = c.get('auth');
    const announcement = await options.bulletinBoardRepository.find({
      tenantId: auth.membership.tenantId,
      userId: auth.userId,
      role: auth.membership.role,
      announcementId,
    });
    if (!announcement)
      return errorResponse(
        c,
        404,
        'ANNOUNCEMENT_NOT_FOUND',
        '回覧が見つかりません。',
      );
    return c.json({ data: projectAnnouncement(announcement) });
  });

  app.post('/api/v1/announcements/:announcementId/read', async (c) => {
    if (!options.bulletinBoardRepository)
      return errorResponse(
        c,
        503,
        'DEPENDENCY_UNAVAILABLE',
        '回覧板データストアが設定されていません。',
      );
    const announcementId = parseAnnouncementId(c);
    if (!announcementId)
      return errorResponse(
        c,
        404,
        'ANNOUNCEMENT_NOT_FOUND',
        '回覧が見つかりません。',
      );
    const auth = c.get('auth');
    const result = await options.bulletinBoardRepository.markRead({
      tenantId: auth.membership.tenantId,
      actorUserId: auth.userId,
      role: auth.membership.role,
      announcementId,
    });
    if (!result)
      return errorResponse(
        c,
        404,
        'ANNOUNCEMENT_NOT_FOUND',
        '回覧が見つかりません。',
      );
    return c.json({ data: { readAt: result.readAt.toISOString() } });
  });

  app.get('/api/v1/announcements/:announcementId/unread', async (c) => {
    if (!options.bulletinBoardRepository)
      return errorResponse(
        c,
        503,
        'DEPENDENCY_UNAVAILABLE',
        '回覧板データストアが設定されていません。',
      );
    const announcementId = parseAnnouncementId(c);
    if (!announcementId)
      return errorResponse(
        c,
        404,
        'ANNOUNCEMENT_NOT_FOUND',
        '回覧が見つかりません。',
      );
    const auth = c.get('auth');
    const unread = await options.bulletinBoardRepository.listUnread({
      tenantId: auth.membership.tenantId,
      actorUserId: auth.userId,
      role: auth.membership.role,
      announcementId,
    });
    // 非掲載者・別テナント・存在しないIDを同じ404にし、存在推測を防ぐ。
    if (!unread)
      return errorResponse(
        c,
        404,
        'ANNOUNCEMENT_NOT_FOUND',
        '回覧が見つかりません。',
      );
    return c.json({
      data: unread.map((member: UnreadMember) => ({
        userId: member.userId,
        role: member.role,
      })),
      unreadCount: unread.length,
    });
  });

  return app;
}
