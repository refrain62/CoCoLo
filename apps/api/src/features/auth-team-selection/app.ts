import {
  type AuthClaims,
  extractBearerToken,
  type TokenVerifier,
} from '@cocolo/auth';
import {
  type TeamOption,
  teamSelectionRequestSchema,
} from '@cocolo/contracts/auth-team-selection';
import type { AuthTeamSelectionRepository } from '@cocolo/db/auth-team-selection';
import {
  listSelectableTeams,
  type SelectableTeam,
  selectTeam,
  TeamSelectionError,
} from '@cocolo/domain/auth-team-selection';
import { type Context, Hono, type MiddlewareHandler } from 'hono';

type AuthTeamSelectionEnv = {
  Variables: {
    requestId: string;
    userId: string;
  };
};

export type AuthTeamSelectionAppOptions = {
  verifyToken?: TokenVerifier;
  repository?: AuthTeamSelectionRepository;
};

type ErrorStatus = 400 | 401 | 403 | 500 | 503;

function errorResponse(
  context: Context<AuthTeamSelectionEnv>,
  status: ErrorStatus,
  code: string,
  message: string,
  details: unknown = {},
) {
  return context.json(
    {
      error: {
        code,
        message,
        details,
        requestId: context.get('requestId'),
      },
    },
    status,
  );
}

function toTeamOption(team: SelectableTeam): TeamOption {
  return team;
}

function selectionErrorResponse(
  context: Context<AuthTeamSelectionEnv>,
  error: TeamSelectionError,
) {
  if (error.code === 'INVALID_TEAM_ID')
    return errorResponse(
      context,
      400,
      'VALIDATION_ERROR',
      '入力値が不正です。',
      { field: 'tenantId' },
    );
  return errorResponse(
    context,
    403,
    'FORBIDDEN',
    '選択できるチームではありません。',
  );
}

// 認証済み利用者のactive所属だけを返し、チーム選択の認可をAPI境界で完結させる。
export function createAuthTeamSelectionApp(
  options: AuthTeamSelectionAppOptions = {},
): Hono<AuthTeamSelectionEnv> {
  const app = new Hono<AuthTeamSelectionEnv>();

  app.use('*', async (context, next) => {
    context.set(
      'requestId',
      context.req.header('x-request-id') ?? crypto.randomUUID(),
    );
    await next();
  });

  // 内部例外の詳細や所属情報を返さず、requestIdだけで調査できる失敗応答にする。
  app.onError((error, context) => {
    void error;
    return errorResponse(
      context,
      500,
      'INTERNAL_SERVER_ERROR',
      '予期しないエラーが発生しました。',
    );
  });

  const authenticate: MiddlewareHandler<AuthTeamSelectionEnv> = async (
    context,
    next,
  ) => {
    if (!options.verifyToken || !options.repository)
      return errorResponse(
        context,
        503,
        'AUTH_NOT_CONFIGURED',
        '認証・所属解決が設定されていません。',
      );
    const token = extractBearerToken(
      context.req.header('authorization') ?? null,
    );
    if (!token)
      return errorResponse(context, 401, 'UNAUTHENTICATED', '認証が必要です。');

    let claims: AuthClaims;
    try {
      claims = await options.verifyToken(token);
    } catch {
      return errorResponse(
        context,
        401,
        'UNAUTHENTICATED',
        '認証情報を確認できません。',
      );
    }
    if (
      typeof claims.userId !== 'string' ||
      claims.userId.length === 0 ||
      claims.expiresAt <= Math.floor(Date.now() / 1000)
    )
      return errorResponse(
        context,
        401,
        'UNAUTHENTICATED',
        '認証の有効期限が切れています。',
      );
    context.set('userId', claims.userId);
    await next();
  };

  app.use('/teams', authenticate);
  app.use('/teams/*', authenticate);

  app.get('/teams', async (context) => {
    if (!options.repository)
      return errorResponse(
        context,
        503,
        'DEPENDENCY_UNAVAILABLE',
        '所属データストアが設定されていません。',
      );
    const memberships = await options.repository.listActiveMemberships(
      context.get('userId'),
    );
    const teams = listSelectableTeams(memberships).map(toTeamOption);
    if (teams.length === 0)
      return errorResponse(
        context,
        403,
        'FORBIDDEN',
        '利用可能な所属がありません。',
      );
    return context.json({ data: teams });
  });

  app.post('/teams/select', async (context) => {
    if (!options.repository)
      return errorResponse(
        context,
        503,
        'DEPENDENCY_UNAVAILABLE',
        '所属データストアが設定されていません。',
      );
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return errorResponse(
        context,
        400,
        'VALIDATION_ERROR',
        'JSON入力が不正です。',
      );
    }
    const parsed = teamSelectionRequestSchema.safeParse(body);
    if (!parsed.success)
      return errorResponse(
        context,
        400,
        'VALIDATION_ERROR',
        '入力値が不正です。',
        parsed.error.flatten(),
      );

    const membership = await options.repository.findActiveMembership(
      context.get('userId'),
      parsed.data.tenantId,
    );
    try {
      const selected = selectTeam(
        membership ? [membership] : [],
        parsed.data.tenantId,
      );
      return context.json({ data: toTeamOption(selected) });
    } catch (error) {
      if (error instanceof TeamSelectionError)
        return selectionErrorResponse(context, error);
      throw error;
    }
  });

  return app;
}
