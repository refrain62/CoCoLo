import {
  invitationAcceptSchema,
  invitationCreateSchema,
  invitationIdSchema,
} from '@cocolo/contracts/auth-invitation';
import {
  AuthInvitationError,
  type AuthInvitationRepository,
} from '@cocolo/db/auth-invitation';
import { type Context, Hono } from 'hono';
import type { ApiEnv } from '../../app.js';

type InvitationAuth = ApiEnv['Variables']['auth'];
type ManagerAuth = Omit<InvitationAuth, 'membership'> & {
  membership: Omit<InvitationAuth['membership'], 'role'> & {
    role: 'owner' | 'admin';
  };
};

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

function getManagerAuth(c: Context<ApiEnv>): ManagerAuth {
  const auth = c.get('auth');
  if (!auth?.userId || !auth.membership?.tenantId)
    throw new Error('認証コンテキストが設定されていません。');
  if (auth.membership.role !== 'owner' && auth.membership.role !== 'admin')
    throw new AuthInvitationError(
      'FORBIDDEN',
      '招待を操作する権限がありません。',
      403,
    );
  return auth as ManagerAuth;
}

function projectInvitation(invitation: {
  id: string;
  memberId: string;
  role: 'guardian';
  relationship: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expiresAt: Date;
  acceptedAt: Date | null;
}) {
  return {
    id: invitation.id,
    memberId: invitation.memberId,
    role: invitation.role,
    relationship: invitation.relationship,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
  };
}

export function createAuthInvitationApp(options: {
  repository?: AuthInvitationRepository;
}): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.onError((error, c) => {
    if (error instanceof AuthInvitationError)
      return errorResponse(c, error.status, error.code, error.message);
    return errorResponse(
      c,
      500,
      'INTERNAL_SERVER_ERROR',
      '予期しないエラーが発生しました。',
    );
  });

  app.get('/api/v1/auth/invitations', async (c) => {
    if (!options.repository)
      return errorResponse(
        c,
        503,
        'DEPENDENCY_UNAVAILABLE',
        '招待データストアが設定されていません。',
      );
    const auth = getManagerAuth(c);
    const invitations = await options.repository.list({
      tenantId: auth.membership.tenantId,
      actorUserId: auth.userId,
      role: auth.membership.role,
    });
    return c.json({ data: invitations.map(projectInvitation) });
  });

  app.post('/api/v1/auth/invitations', async (c) => {
    if (!options.repository)
      return errorResponse(
        c,
        503,
        'DEPENDENCY_UNAVAILABLE',
        '招待データストアが設定されていません。',
      );
    const auth = getManagerAuth(c);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, 'VALIDATION_ERROR', 'JSON入力が不正です。');
    }
    const parsed = invitationCreateSchema.safeParse(body);
    if (!parsed.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        '入力値が不正です。',
        parsed.error.flatten(),
      );
    const invitation = await options.repository.create({
      tenantId: auth.membership.tenantId,
      actorUserId: auth.userId,
      role: auth.membership.role,
      memberId: parsed.data.memberId,
      relationship: parsed.data.relationship,
      expiresAt: new Date(
        Date.now() + parsed.data.expiresInHours * 60 * 60 * 1000,
      ),
    });
    return c.json(
      {
        data: {
          ...projectInvitation(invitation),
          token: invitation.token,
        },
      },
      201,
    );
  });

  app.post('/api/v1/auth/invitations/:invitationId/revoke', async (c) => {
    if (!options.repository)
      return errorResponse(
        c,
        503,
        'DEPENDENCY_UNAVAILABLE',
        '招待データストアが設定されていません。',
      );
    const auth = getManagerAuth(c);
    const parsedId = invitationIdSchema.safeParse(c.req.param('invitationId'));
    if (!parsedId.success)
      return errorResponse(c, 400, 'VALIDATION_ERROR', '招待IDが不正です。');
    const invitation = await options.repository.revoke({
      tenantId: auth.membership.tenantId,
      actorUserId: auth.userId,
      role: auth.membership.role,
      invitationId: parsedId.data,
    });
    if (!invitation)
      return errorResponse(c, 404, 'NOT_FOUND', '招待が見つかりません。');
    return c.json({ data: projectInvitation(invitation) });
  });

  app.post('/api/v1/auth/invitations/accept', async (c) => {
    if (!options.repository)
      return errorResponse(
        c,
        503,
        'DEPENDENCY_UNAVAILABLE',
        '招待データストアが設定されていません。',
      );
    const userId = c.get('authUserId');
    if (!userId)
      return errorResponse(c, 401, 'UNAUTHENTICATED', '認証が必要です。');
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, 'VALIDATION_ERROR', 'JSON入力が不正です。');
    }
    const parsed = invitationAcceptSchema.safeParse(body);
    if (!parsed.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        '入力値が不正です。',
        parsed.error.flatten(),
      );
    if (!c.get('authProviders').includes(parsed.data.provider))
      return errorResponse(
        c,
        403,
        'OAUTH_PROVIDER_UNVERIFIED',
        'LINEまたはGoogleの認証状態を確認できません。OAuthで再ログインしてください。',
      );
    const result = await options.repository.accept({
      userId,
      provider: parsed.data.provider,
      token: parsed.data.token,
    });
    return c.json({ data: result });
  });

  return app;
}
