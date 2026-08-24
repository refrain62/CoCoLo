import { extractBearerToken, type TokenVerifier } from '@cocolo/auth';
import type { MemberRole } from '@cocolo/contracts/member';
import type { LineNotification } from '@cocolo/domain/line';
import {
  LineConnectionConflictError,
  LineNotificationStateError,
} from '@cocolo/domain/line';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import type { LineActor, LineNotificationService } from './line-service.js';

type Membership = { tenantId: string; role: MemberRole };
type CentralAuth = {
  userId: string;
  membership: Membership;
};
export type LineRouteOptions = {
  verifyToken?: TokenVerifier;
  findActiveMembership?: (userId: string) => Promise<Membership | null>;
  service: LineNotificationService;
  useCentralAuth?: boolean;
  includeNotifications?: boolean;
  includeWebhook?: boolean;
};

type LineApiEnv = {
  Variables: {
    requestId: string;
    auth: LineActor | CentralAuth;
  };
};

function errorResponse(
  c: Context<LineApiEnv>,
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

function serviceError(c: Context<LineApiEnv>, error: unknown) {
  if (error instanceof LineConnectionConflictError)
    return errorResponse(c, 409, error.code, error.message);
  if (error instanceof LineNotificationStateError)
    return errorResponse(c, 409, error.code, error.message);
  if (error instanceof Error && error.message.includes('権限'))
    return errorResponse(c, 403, 'FORBIDDEN', error.message);
  return errorResponse(c, 400, 'VALIDATION_ERROR', '入力値が不正です。');
}

// tenantや作成者などの内部項目をLINE操作APIの公開DTOへ含めない。
function publicNotification(notification: LineNotification) {
  return {
    id: notification.id,
    sourceType: notification.sourceType,
    sourceId: notification.sourceId,
    status: notification.status,
    attempts: notification.attempts,
    nextRetryAt: notification.nextRetryAt,
  };
}

// LINE専用routeを単体で検証し、将来の中央appへmountできるよう既存app.tsを変更せず公開する。
export function createLineNotificationApp(
  options: LineRouteOptions,
): Hono<LineApiEnv> {
  const app = new Hono<LineApiEnv>();
  app.use('*', async (c, next) => {
    const requestId =
      c.get('requestId') ?? c.req.header('x-request-id') ?? crypto.randomUUID();
    c.set('requestId', requestId);
    c.header('x-request-id', requestId);
    await next();
  });

  function currentActor(c: Context<LineApiEnv>): LineActor {
    const auth = c.get('auth');
    if ('membership' in auth)
      return {
        tenantId: auth.membership.tenantId,
        userId: auth.userId,
        role: auth.membership.role,
      };
    return auth;
  }

  const authenticate: MiddlewareHandler<LineApiEnv> = async (c, next) => {
    const token = extractBearerToken(c.req.header('authorization') ?? null);
    if (!options.verifyToken || !options.findActiveMembership)
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
      const membership = await options.findActiveMembership(claims.userId);
      if (!membership)
        return errorResponse(
          c,
          403,
          'FORBIDDEN',
          '利用可能な所属がありません。',
        );
      c.set('auth', { ...membership, userId: claims.userId });
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

  if (!options.useCentralAuth)
    for (const path of [
      '/api/v1/line/status',
      '/api/v1/line/connect',
      '/api/v1/line/notifications',
      '/api/v1/line/notifications/*',
    ])
      app.use(path, authenticate);

  app.onError((error, c) => {
    void error;
    return errorResponse(
      c,
      500,
      'INTERNAL_SERVER_ERROR',
      '予期しないエラーが発生しました。',
    );
  });

  app.get('/api/v1/line/status', async (c) => {
    const actor = currentActor(c);
    const value = await options.service.status(actor);
    return c.json({
      data: {
        status: value.status,
        groupId:
          actor.role === 'owner' || actor.role === 'admin'
            ? value.groupId
            : null,
      },
    });
  });

  app.post('/api/v1/line/connect', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return errorResponse(c, 400, 'VALIDATION_ERROR', 'JSON入力が不正です。');
    }
    try {
      return c.json(
        { data: await options.service.connect(currentActor(c), input) },
        201,
      );
    } catch (error) {
      return serviceError(c, error);
    }
  });

  app.delete('/api/v1/line/connect', async (c) => {
    try {
      await options.service.disconnect(currentActor(c));
      return c.json({ data: { status: 'disconnected' } });
    } catch (error) {
      return serviceError(c, error);
    }
  });

  if (options.includeNotifications !== false) {
    app.post('/api/v1/line/notifications', async (c) => {
      let input: unknown;
      try {
        input = await c.req.json();
      } catch {
        return errorResponse(
          c,
          400,
          'VALIDATION_ERROR',
          'JSON入力が不正です。',
        );
      }
      try {
        const result = await options.service.enqueue(currentActor(c), input);
        const data =
          result.status === 'queued'
            ? {
                ...result,
                notification: publicNotification(result.notification),
              }
            : result;
        return c.json({ data }, result.status === 'queued' ? 202 : 200);
      } catch (error) {
        return serviceError(c, error);
      }
    });

    app.post('/api/v1/line/notifications/:notificationId/retry', async (c) => {
      try {
        const notification = await options.service.retry(
          currentActor(c),
          c.req.param('notificationId'),
        );
        return c.json({ data: publicNotification(notification) });
      } catch (error) {
        return serviceError(c, error);
      }
    });
  }

  if (options.includeWebhook !== false)
    app.post('/api/v1/line/webhook', async (c) => {
      const rawBody = await c.req.text();
      try {
        const result = await options.service.receiveWebhook({
          rawBody,
          signature: c.req.header('x-line-signature') ?? null,
        });
        return c.json({ data: result });
      } catch (error) {
        if (error instanceof Error && error.message.includes('署名'))
          return errorResponse(
            c,
            401,
            'LINE_SIGNATURE_INVALID',
            'LINE webhookの署名が不正です。',
          );
        if (error instanceof SyntaxError)
          return errorResponse(
            c,
            400,
            'VALIDATION_ERROR',
            'Webhook JSONが不正です。',
          );
        return serviceError(c, error);
      }
    });

  return app;
}
