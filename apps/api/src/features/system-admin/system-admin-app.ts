import {
  featureKeySchema,
  systemAnnouncementCreateSchema,
  systemAnnouncementUpdateSchema,
  systemFeatureUpdateSchema,
} from '@cocolo/contracts';
import { uuidv7Schema } from '@cocolo/contracts/auth-team-selection';
import {
  type SystemAdminRepository,
  SystemAdminRepositoryError,
} from '@cocolo/db';
import { type Context, Hono } from 'hono';
import type { ApiEnv } from '../../app.js';

function errorResponse(
  c: Context<ApiEnv>,
  status: 400 | 401 | 403 | 404 | 409 | 500 | 503,
  code: string,
  message: string,
  details: unknown = {},
) {
  return c.json(
    { error: { code, message, details, requestId: c.get('requestId') } },
    status,
  );
}

function actorUserId(c: Context<ApiEnv>) {
  const auth = c.get('systemAuth');
  if (!auth?.userId) throw new Error('system admin認証が設定されていません。');
  return auth.userId;
}

function projectAnnouncement(record: {
  id: string;
  title: string;
  body: string;
  status: 'draft' | 'published' | 'archived';
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    title: record.title,
    body: record.body,
    status: record.status,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

// system admin APIはtenant headerを使わず、JWTのsystem_admin claimとRLS側のsystem_admin roleを二重に要求する。
export function createSystemAdminApp({
  repository,
}: {
  repository?: SystemAdminRepository;
}) {
  const app = new Hono<ApiEnv>();
  app.onError((error, c) => {
    if (error instanceof SystemAdminRepositoryError)
      return errorResponse(c, error.status, error.code, error.message);
    return errorResponse(
      c,
      500,
      'INTERNAL_SERVER_ERROR',
      '予期しないエラーが発生しました。',
    );
  });

  function requireRepository(c: Context<ApiEnv>) {
    if (!repository) {
      return errorResponse(
        c,
        503,
        'DEPENDENCY_UNAVAILABLE',
        'システム管理データストアが設定されていません。',
      );
    }
    return repository;
  }

  app.get('/api/v1/system/announcements', async (c) => {
    const store = requireRepository(c);
    if (store instanceof Response) return store;
    const records = await store.listAnnouncements(actorUserId(c));
    return c.json({ data: records.map(projectAnnouncement) });
  });

  // system adminが公開した全体お知らせを、選択中チームのactive membershipへ限定して返す。
  app.get('/api/v1/global-announcements', async (c) => {
    const store = requireRepository(c);
    if (store instanceof Response) return store;
    const auth = c.get('auth');
    if (!auth)
      return errorResponse(c, 401, 'UNAUTHENTICATED', '認証が必要です。');
    const records = await store.listPublishedAnnouncements({
      tenantId: auth.membership.tenantId,
      userId: auth.userId,
      role: auth.membership.role,
    });
    return c.json({ data: records.map(projectAnnouncement) });
  });

  app.post('/api/v1/system/announcements', async (c) => {
    const store = requireRepository(c);
    if (store instanceof Response) return store;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, 'VALIDATION_ERROR', 'JSON入力が不正です。');
    }
    const parsed = systemAnnouncementCreateSchema.safeParse(body);
    if (!parsed.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        '全体お知らせの入力が不正です。',
        parsed.error.flatten(),
      );
    const record = await store.createAnnouncement({
      actorUserId: actorUserId(c),
      ...parsed.data,
    });
    return c.json({ data: projectAnnouncement(record) }, 201);
  });

  app.patch('/api/v1/system/announcements/:announcementId', async (c) => {
    const store = requireRepository(c);
    if (store instanceof Response) return store;
    const parsedId = uuidv7Schema.safeParse(c.req.param('announcementId'));
    if (!parsedId.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'お知らせIDが不正です。',
      );
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, 'VALIDATION_ERROR', 'JSON入力が不正です。');
    }
    const parsed = systemAnnouncementUpdateSchema.safeParse(body);
    if (!parsed.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        '全体お知らせの更新内容が不正です。',
        parsed.error.flatten(),
      );
    const record = await store.updateAnnouncement({
      actorUserId: actorUserId(c),
      announcementId: parsedId.data,
      ...parsed.data,
    });
    if (!record)
      return errorResponse(
        c,
        404,
        'NOT_FOUND',
        '全体お知らせが見つかりません。',
      );
    return c.json({ data: projectAnnouncement(record) });
  });

  app.get('/api/v1/system/features', async (c) => {
    const store = requireRepository(c);
    if (store instanceof Response) return store;
    return c.json({ data: await store.listFeatures(actorUserId(c)) });
  });

  app.patch('/api/v1/system/features/:featureKey', async (c) => {
    const store = requireRepository(c);
    if (store instanceof Response) return store;
    const parsedKey = featureKeySchema.safeParse(c.req.param('featureKey'));
    if (!parsedKey.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'feature keyが不正です。',
      );
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, 'VALIDATION_ERROR', 'JSON入力が不正です。');
    }
    const parsed = systemFeatureUpdateSchema.safeParse(body);
    if (!parsed.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        '機能提供設定の入力が不正です。',
        parsed.error.flatten(),
      );
    const feature = await store.setFeatureEnabled({
      actorUserId: actorUserId(c),
      featureKey: parsedKey.data,
      enabled: parsed.data.enabled,
      reason: parsed.data.reason,
    });
    return c.json({ data: feature });
  });

  return app;
}
