import { extractBearerToken, type TokenVerifier } from '@cocolo/auth';
import type {
  MemberCreateInput,
  MemberListQuery,
  MemberRole,
  MemberUpdateInput,
  PromotionMode,
} from '@cocolo/contracts/member';
import {
  memberCreateSchema,
  memberIdSchema,
  memberListQuerySchema,
  memberUpdateSchema,
  promotionRequestSchema,
} from '@cocolo/contracts/member';
import {
  createCentralAuthMiddleware,
  createCentralCorsMiddleware,
  createCentralPathValidationMiddleware,
  createCentralRateLimitMiddleware,
  createCentralRequestContextMiddleware,
  createCentralRequestLoggerMiddleware,
  createCentralResponseValidationMiddleware,
  mountCentralFeatureRoutes,
  type CentralApiEnv,
  type CentralAppOptions,
} from './central-dependencies.js';
import { type Context, Hono, type MiddlewareHandler } from 'hono';

export type MembershipContext = {
  tenantId: string;
  role: MemberRole;
};

export type MemberRecord = {
  id: string;
  tenantId: string;
  name: string;
  kana: string | null;
  category: 'student' | 'adult';
  gradeLevel: number | null;
  ageGroup: string | null;
  status: 'active' | 'suspended' | 'retired';
  createdAt: string | Date;
};

export type MembershipRepository = {
  findActiveByUserId: (userId: string) => Promise<MembershipContext | null>;
};

export type MemberRepository = {
  list: (input: {
    tenantId: string;
    userId: string;
    role: MemberRole;
    query: MemberListQuery;
  }) => Promise<MemberRecord[]>;
  create: (
    input: {
      tenantId: string;
      actorUserId: string;
      role: MemberRole;
    },
    member: MemberCreateInput,
  ) => Promise<MemberRecord>;
  update?: (input: {
    tenantId: string;
    actorUserId: string;
    role: MemberRole;
    memberId: string;
    member: MemberUpdateInput;
  }) => Promise<MemberRecord | null>;
  retire?: (input: {
    tenantId: string;
    actorUserId: string;
    role: MemberRole;
    memberId: string;
  }) => Promise<MemberRecord | null>;
};

export type PromotionRecord = {
  mode: PromotionMode;
  fiscalYear: number;
  status: 'preview' | 'completed' | 'failed';
  previewCount: number;
  promotedCount: number;
  result: unknown;
};

export type PromotionRepository = {
  run: (input: {
    tenantId: string;
    actorUserId: string;
    role: MemberRole;
    mode: PromotionMode;
    fiscalYear: number;
    idempotencyKey: string | null;
  }) => Promise<PromotionRecord>;
};

export type AppOptions = {
  verifyToken?: TokenVerifier;
  membershipRepository?: MembershipRepository;
  memberRepository?: MemberRepository;
  promotionRepository?: PromotionRepository;
  central?: CentralAppOptions;
};

export type ApiEnv = CentralApiEnv;

const managerRoles = new Set<MemberRole>(['owner', 'admin']);

// エラー形式とrequestIdを全エンドポイントで統一し、内部例外の詳細は外部へ返さない。
function errorResponse(
  c: Context<ApiEnv>,
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

// 役割ごとの公開項目をここで固定し、guardian/staffへ不要な個人情報を返さない。
function projectMember(member: MemberRecord, role: MemberRole) {
  const common = {
    id: member.id,
    name: member.name,
    kana: member.kana,
    category: member.category,
    gradeLevel: member.gradeLevel,
    status: member.status,
  };
  if (role === 'guardian') return common;
  if (role === 'staff') return { ...common, ageGroup: member.ageGroup };
  return {
    ...common,
    ageGroup: member.ageGroup,
    createdAt:
      member.createdAt instanceof Date
        ? member.createdAt.toISOString()
        : member.createdAt,
  };
}

// APIの依存性と認証middlewareを組み立て、tenant/roleは認証後の所属解決結果だけを利用する。
export function createApp(options: AppOptions = {}) {
  const app = new Hono<ApiEnv>();
  const central = options.central ?? {};

  app.use(
    '*',
    createCentralRequestLoggerMiddleware({
      environment: central.environment ?? 'local',
      sink: central.logSink,
    }),
  );
  app.use(
    '*',
    createCentralCorsMiddleware(
      central.corsOrigins ?? ['http://localhost:5173'],
    ),
  );
  app.use('*', createCentralRequestContextMiddleware());
  app.use(
    '/api/v1/*',
    createCentralAuthMiddleware(
      options.verifyToken,
      options.membershipRepository,
      (context) =>
        new URL(context.req.url).pathname === '/api/v1/line/webhook',
    ),
  );
  app.use('/api/v1/*', createCentralPathValidationMiddleware());
  app.use(
    '/api/v1/*',
    createCentralRateLimitMiddleware({
      store: central.rateLimitStore,
      requireDistributed: central.requireDistributedRateLimitStore,
      clientIdentityResolver: central.clientIdentityResolver,
    }),
  );
  app.use('*', createCentralResponseValidationMiddleware());

  // 予期せぬ例外は詳細を隠し、クライアントにはrequestId付きの共通500だけを返す。
  app.onError((error, c) => {
    void error;
    return errorResponse(
      c,
      500,
      'INTERNAL_SERVER_ERROR',
      '予期しないエラーが発生しました。',
    );
  });

  app.notFound((c) =>
    errorResponse(c, 404, 'NOT_FOUND', '指定されたAPIが見つかりません。'),
  );

  app.get('/health', (c) => c.json({ status: 'ok', service: 'api' }));

  // JWTの有効期限とactive membershipを確認してから後続handlerへ認証コンテキストを渡す。失敗はfail-closedとする。
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

  app.use('/api/v1/members', authenticate);
  app.use('/api/v1/members/*', authenticate);

  // tenantIdはリクエストから受け取らず、authenticateが設定した所属をrepositoryへ渡す。
  app.get('/api/v1/members', async (c) => {
    if (!options.memberRepository)
      return errorResponse(
        c,
        503,
        'DEPENDENCY_UNAVAILABLE',
        '部員データストアが設定されていません。',
      );
    const parsed = memberListQuerySchema.safeParse(c.req.query());
    if (!parsed.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        '入力値が不正です。',
        parsed.error.flatten(),
      );
    const auth = c.get('auth');
    const members = await options.memberRepository.list({
      tenantId: auth.membership.tenantId,
      userId: auth.userId,
      role: auth.membership.role,
      query: parsed.data,
    });
    return c.json({
      data: members.map((member) =>
        projectMember(member, auth.membership.role),
      ),
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    });
  });

  // 部員登録はowner/adminだけに許可し、作成者とtenantは認証コンテキストから決定する。
  app.post('/api/v1/members', async (c) => {
    if (!options.memberRepository)
      return errorResponse(
        c,
        503,
        'DEPENDENCY_UNAVAILABLE',
        '部員データストアが設定されていません。',
      );
    const auth = c.get('auth');
    if (!managerRoles.has(auth.membership.role))
      return errorResponse(
        c,
        403,
        'FORBIDDEN',
        '部員を登録する権限がありません。',
      );
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, 'VALIDATION_ERROR', 'JSON入力が不正です。');
    }
    const parsed = memberCreateSchema.safeParse(body);
    if (!parsed.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        '入力値が不正です。',
        parsed.error.flatten(),
      );
    const member = await options.memberRepository.create(
      {
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
      },
      parsed.data,
    );
    return c.json({ data: projectMember(member, auth.membership.role) }, 201);
  });

  app.patch('/api/v1/members/:memberId', async (c) => {
    if (!options.memberRepository?.update)
      return errorResponse(
        c,
        503,
        'DEPENDENCY_UNAVAILABLE',
        '部員データストアが設定されていません。',
      );
    const auth = c.get('auth');
    if (!managerRoles.has(auth.membership.role))
      return errorResponse(
        c,
        403,
        'FORBIDDEN',
        '部員を編集する権限がありません。',
      );
    const memberId = memberIdSchema.safeParse(c.req.param('memberId'));
    if (!memberId.success)
      return errorResponse(c, 400, 'VALIDATION_ERROR', '部員IDが不正です。');
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, 'VALIDATION_ERROR', 'JSON入力が不正です。');
    }
    const parsed = memberUpdateSchema.safeParse(body);
    if (!parsed.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        '入力値が不正です。',
        parsed.error.flatten(),
      );
    try {
      const member = await options.memberRepository.update({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
        memberId: memberId.data,
        member: parsed.data,
      });
      if (!member)
        return errorResponse(c, 404, 'NOT_FOUND', '部員が見つかりません。');
      return c.json({ data: projectMember(member, auth.membership.role) });
    } catch (error) {
      if (
        error instanceof Error &&
        'status' in error &&
        error.status === 409
      )
        return errorResponse(
          c,
          409,
          'MEMBER_CONFLICT',
          '部員の状態が競合しました。',
        );
      throw error;
    }
  });

  app.post('/api/v1/members/:memberId/retire', async (c) => {
    if (!options.memberRepository?.retire)
      return errorResponse(
        c,
        503,
        'DEPENDENCY_UNAVAILABLE',
        '部員データストアが設定されていません。',
      );
    const auth = c.get('auth');
    if (!managerRoles.has(auth.membership.role))
      return errorResponse(
        c,
        403,
        'FORBIDDEN',
        '部員を退部させる権限がありません。',
      );
    const memberId = memberIdSchema.safeParse(c.req.param('memberId'));
    if (!memberId.success)
      return errorResponse(c, 400, 'VALIDATION_ERROR', '部員IDが不正です。');
    try {
      const member = await options.memberRepository.retire({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
        memberId: memberId.data,
      });
      if (!member)
        return errorResponse(c, 404, 'NOT_FOUND', '部員が見つかりません。');
      return c.json({ data: projectMember(member, auth.membership.role) });
    } catch (error) {
      if (
        error instanceof Error &&
        'status' in error &&
        error.status === 409
      )
        return errorResponse(
          c,
          409,
          'MEMBER_CONFLICT',
          '部員の状態が競合しました。',
        );
      throw error;
    }
  });

  app.post('/api/v1/members/promote', async (c) => {
    if (!options.promotionRepository)
      return errorResponse(
        c,
        503,
        'DEPENDENCY_UNAVAILABLE',
        '年度繰り上げデータストアが設定されていません。',
      );
    const auth = c.get('auth');
    if (!managerRoles.has(auth.membership.role))
      return errorResponse(
        c,
        403,
        'FORBIDDEN',
        '年度繰り上げを実行する権限がありません。',
      );
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, 'VALIDATION_ERROR', 'JSON入力が不正です。');
    }
    const parsed = promotionRequestSchema.safeParse(body);
    if (!parsed.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        '入力値が不正です。',
        parsed.error.flatten(),
      );
    const idempotencyKey = c.req.header('idempotency-key')?.trim() || null;
    if (idempotencyKey && idempotencyKey.length > 128)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'Idempotency-Key が長すぎます。',
      );
    if (parsed.data.mode === 'execute' && !idempotencyKey)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        '実行モードでは Idempotency-Key が必要です。',
      );
    try {
      const promotion = await options.promotionRepository.run({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
        mode: parsed.data.mode,
        fiscalYear: parsed.data.fiscalYear,
        idempotencyKey,
      });
      return c.json({ data: promotion });
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 409)
        return errorResponse(
          c,
          409,
          'PROMOTION_CONFLICT',
          '年度繰り上げの実行が競合しました。',
        );
      throw error;
    }
  });

  mountCentralFeatureRoutes(app, {
    verifyToken: options.verifyToken,
    membershipRepository: options.membershipRepository,
    features: central.features,
  });

  return app;
}
