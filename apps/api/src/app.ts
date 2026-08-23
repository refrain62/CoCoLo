import { extractBearerToken, type TokenVerifier } from '@cocolo/auth';
import { lineDeliveryPublishSchema } from '@cocolo/contracts/line-delivery';
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
  lineDeliveryResponseSchema,
  memberListResponseSchema,
  memberMutationResponseSchema,
  promotionResponseSchema,
} from '@cocolo/contracts/runtime-response';
import type { LineDeliveryProducer } from '@cocolo/db';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { type CorsOptions, createCorsMiddleware } from './security/cors.js';
import {
  createRateLimitMiddleware,
  type InMemoryRateLimitStore,
  rateLimitPolicies,
} from './security/rate-limit.js';
import {
  createConfiguredRateLimitStore,
  type DistributedRateLimitAdapter,
  type RateLimitEnvironment,
  type RateLimitStoreMode,
} from './security/rate-limit-adapter.js';
import {
  createResponseContractMiddleware,
  type ResponseContract,
} from './security/response-contract.js';
import {
  createRequestLoggerMiddleware,
  createStructuredLogger,
  type StructuredLogger,
} from './security/structured-logger.js';

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
  update: (input: {
    tenantId: string;
    actorUserId: string;
    role: MemberRole;
    memberId: string;
    member: MemberUpdateInput;
  }) => Promise<MemberRecord | null>;
  retire: (input: {
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
  lineDeliveryProducer?: LineDeliveryProducer;
  cors?: CorsOptions;
  observability?: {
    environment?: RateLimitEnvironment;
    logger?: StructuredLogger;
    pathResolver?: (context: Context<ApiEnv>) => string;
  };
  rateLimit?: {
    environment?: RateLimitEnvironment;
    mode?: RateLimitStoreMode;
    adapter?: DistributedRateLimitAdapter;
    distributedAdapter?: DistributedRateLimitAdapter;
    localStore?: InMemoryRateLimitStore;
    now?: () => number;
    namespace?: RateLimitEnvironment;
    timeoutMs?: number;
  };
};

export type ApiEnv = {
  Variables: {
    requestId: string;
    auth: {
      userId: string;
      membership: MembershipContext;
    };
  };
};

const managerRoles = new Set<MemberRole>(['owner', 'admin']);

function hasUnsafeControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

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
  const rateLimitOptions = options.rateLimit ?? {};
  const rateLimitEnvironment = rateLimitOptions.environment ?? 'local';
  const rateLimitNamespace = rateLimitOptions.namespace ?? rateLimitEnvironment;
  if (rateLimitNamespace !== rateLimitEnvironment)
    throw new Error(
      'rate limit namespaceはAPP_ENV由来の環境名と一致させてください。',
    );
  const rateLimitStore = createConfiguredRateLimitStore({
    appEnv: rateLimitEnvironment,
    mode: rateLimitOptions.mode ?? 'memory',
    adapter: rateLimitOptions.adapter,
    distributedAdapter: rateLimitOptions.distributedAdapter,
    localStore: rateLimitOptions.localStore,
    timeoutMs: rateLimitOptions.timeoutMs,
  });

  app.use('*', async (c, next) => {
    const candidate = c.req.header('x-request-id')?.trim();
    const requestId =
      candidate &&
      candidate.length <= 128 &&
      !hasUnsafeControlCharacter(candidate)
        ? candidate
        : crypto.randomUUID();
    c.set('requestId', requestId);
    c.header('x-request-id', requestId);
    await next();
  });

  const logger =
    options.observability?.logger ?? createStructuredLogger(() => {});
  app.use(
    '*',
    createRequestLoggerMiddleware({
      logger,
      environment: options.observability?.environment ?? rateLimitEnvironment,
      pathResolver: options.observability?.pathResolver,
    }),
  );
  if (options.cors) app.use('*', createCorsMiddleware(options.cors));

  const responseContracts: ResponseContract[] = [
    {
      method: 'GET',
      path: /^\/api\/v1\/members$/,
      status: 200,
      schema: memberListResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/members$/,
      status: 201,
      schema: memberMutationResponseSchema,
    },
    {
      method: 'PATCH',
      path: /^\/api\/v1\/members\/[^/]+$/,
      status: 200,
      schema: memberMutationResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/members\/[^/]+\/retire$/,
      status: 200,
      schema: memberMutationResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/members\/promote$/,
      status: 200,
      schema: promotionResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/notifications\/line$/,
      status: 202,
      schema: lineDeliveryResponseSchema,
    },
  ];
  app.use(
    '*',
    createResponseContractMiddleware({ contracts: responseContracts }),
  );

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

  app.use('/api/v1/members/*', authenticate);
  app.use('/api/v1/notifications/line', authenticate);

  // 認証後のtenant/userだけをキーに使い、production系では起動時に分散adapterを要求する。
  const authenticatedRateLimit = createRateLimitMiddleware({
    scope: 'authenticated',
    ...rateLimitPolicies.authenticated,
    store: rateLimitStore,
    now: rateLimitOptions.now,
    namespace: rateLimitNamespace,
    timeoutMs: rateLimitOptions.timeoutMs,
    keyResolver: (c) => {
      const auth = c.get('auth');
      return {
        kind: 'user',
        tenantId: auth.membership.tenantId,
        userId: auth.userId,
      };
    },
  });
  app.use('/api/v1/members/*', authenticatedRateLimit);
  app.use('/api/v1/notifications/line', authenticatedRateLimit);

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

  // 通常編集はactive/suspendedだけを受け付け、retiredへの遷移を専用操作へ限定する。
  app.patch('/api/v1/members/:memberId', async (c) => {
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
    let member: MemberRecord | null;
    try {
      member = await options.memberRepository.update({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
        memberId: memberId.data,
        member: parsed.data,
      });
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 409)
        return errorResponse(
          c,
          409,
          'MEMBER_STATE_CONFLICT',
          '部員の状態が編集操作と競合しました。',
        );
      throw error;
    }
    if (!member)
      return errorResponse(
        c,
        404,
        'MEMBER_NOT_FOUND',
        '部員が見つかりません。',
      );
    return c.json({ data: projectMember(member, auth.membership.role) });
  });

  // 退部は専用の冪等操作にし、通常編集からretiredへ変更できないようにする。
  app.post('/api/v1/members/:memberId/retire', async (c) => {
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
        '部員を退部にする権限がありません。',
      );
    const memberId = memberIdSchema.safeParse(c.req.param('memberId'));
    if (!memberId.success)
      return errorResponse(c, 400, 'VALIDATION_ERROR', '部員IDが不正です。');
    let member: MemberRecord | null;
    try {
      member = await options.memberRepository.retire({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
        memberId: memberId.data,
      });
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 409)
        return errorResponse(
          c,
          409,
          'MEMBER_STATE_CONFLICT',
          '部員の状態が退部操作と競合しました。',
        );
      throw error;
    }
    if (!member)
      return errorResponse(
        c,
        404,
        'MEMBER_NOT_FOUND',
        '部員が見つかりません。',
      );
    return c.json({ data: projectMember(member, auth.membership.role) });
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

  // 認証済みowner/adminの通知依頼を業務transactionへ渡し、tenantをbodyから受け取らない。
  app.post('/api/v1/notifications/line', async (c) => {
    if (!options.lineDeliveryProducer)
      return errorResponse(
        c,
        503,
        'DEPENDENCY_UNAVAILABLE',
        'LINE通知producerが設定されていません。',
      );
    const auth = c.get('auth');
    if (!managerRoles.has(auth.membership.role))
      return errorResponse(
        c,
        403,
        'FORBIDDEN',
        'LINE通知を登録する権限がありません。',
      );
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, 'VALIDATION_ERROR', 'JSON入力が不正です。');
    }
    const parsed = lineDeliveryPublishSchema.safeParse(body);
    if (!parsed.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        '入力値が不正です。',
        parsed.error.flatten(),
      );
    const idempotencyKey = c.req.header('idempotency-key')?.trim();
    if (!idempotencyKey || idempotencyKey.length > 128)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'LINE通知ではIdempotency-Keyが必要です。',
      );
    try {
      const result = await options.lineDeliveryProducer.publish({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
        ...parsed.data,
        idempotencyKey,
      });
      return c.json(
        { data: { notificationId: result.notificationId, status: 'pending' } },
        202,
      );
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 409)
        return errorResponse(
          c,
          409,
          'LINE_DELIVERY_CONFLICT',
          '同じtenant内で通知の冪等キーまたはpayloadが競合しました。',
        );
      throw error;
    }
  });

  return app;
}
