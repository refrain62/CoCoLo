import { extractBearerToken, type TokenVerifier } from '@cocolo/auth';
import type { MemberRole } from '@cocolo/contracts/member';
import { featureEnvelopeResponseSchema } from '@cocolo/contracts/runtime-response';
import type { AuthTeamSelectionRepository } from '@cocolo/db/auth-team-selection';
import type { BulletinBoardRepository } from '@cocolo/db/bulletin-board';
import type { EventRepository } from '@cocolo/db/events';
import type { OrdersRepository } from '@cocolo/db/orders';
import type { AttachmentRepository } from '@cocolo/domain/attachment';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { createAttachmentApp } from './features/attachments/attachment-app.js';
import type { AttachmentStorage } from './features/attachments/attachment-storage.js';
import { createAuthTeamSelectionApp } from './features/auth-team-selection/app.js';
import {
  type BoardContactRepository,
  createBoardContactApp,
} from './features/board-contact/index.js';
import { createBulletinBoardApp } from './features/bulletin-board/bulletin-board-app.js';
import { createEventsApp } from './features/events/event-api.js';
import type { LineNotificationService } from './features/line-notifications/line-service.js';
import { createLineNotificationApp } from './features/line-notifications/routes.js';
import { createOrdersPaymentsApp } from './features/orders-payments/orders-payments-app.js';
import {
  type RideRouteApp,
  registerRideRoutes,
} from './features/ride-operations/ride-routes.js';
import type { RideService } from './features/ride-operations/ride-service.js';
import { createCorsMiddleware } from './security/cors.js';
import {
  createRateLimitMiddleware,
  type RateLimitIdentity,
  type RateLimitStore,
} from './security/rate-limit.js';
import {
  createResponseContractMiddleware,
  type ResponseContract,
} from './security/response-contract.js';
import {
  createRequestLoggerMiddleware,
  createStructuredLogger,
} from './security/structured-logger.js';

export type CentralMembershipRepository = {
  findActiveByUserId: (
    userId: string,
  ) => Promise<{ tenantId: string; role: MemberRole } | null>;
};

export type CentralAuth = {
  userId: string;
  membership: { tenantId: string; role: MemberRole };
};

export type CentralApiEnv = {
  Variables: {
    requestId: string;
    auth: CentralAuth;
    authUserId: string;
  };
};

export type CentralFeatureDependencies = {
  events?: { repository: EventRepository };
  boardContact?: { repository: BoardContactRepository };
  orders?: { repository: OrdersRepository };
  attachments?: {
    repository: AttachmentRepository;
    storage: AttachmentStorage;
  };
  line?: { service: LineNotificationService };
  ride?: { service: RideService };
  bulletinBoard?: { repository: BulletinBoardRepository };
  authTeamSelection?: { repository: AuthTeamSelectionRepository };
};

export type CentralDatabaseAdapter = {
  client: unknown;
  featureSchemaReady: boolean;
  unavailableReason: string;
};

export type CentralRateLimitConsumeInput = {
  key: string;
  limit: number;
  windowMs: number;
  nowMs: number;
};

export type CentralRateLimitStore = RateLimitStore & {
  distributed?: boolean;
};

type Counter = { count: number; resetAtMs: number };

// localと単一プロセスの検証だけに使い、本番の複数instanceへ持ち込まない固定窓store。
export class InMemoryCentralRateLimitStore implements CentralRateLimitStore {
  private readonly counters = new Map<string, Counter>();

  constructor(private readonly maxEntries = 10_000) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1)
      throw new Error('rate limit storeの最大件数が不正です。');
  }

  consume(input: CentralRateLimitConsumeInput) {
    for (const [key, counter] of this.counters) {
      if (counter.resetAtMs <= input.nowMs) this.counters.delete(key);
    }
    const current = this.counters.get(input.key);
    if (!current && this.counters.size >= this.maxEntries)
      throw new Error('rate limit storeの容量を超えました。');
    const counter =
      !current || current.resetAtMs <= input.nowMs
        ? { count: 0, resetAtMs: input.nowMs + input.windowMs }
        : current;
    counter.count += 1;
    this.counters.set(input.key, counter);
    return {
      allowed: counter.count <= input.limit,
      remaining: Math.max(0, input.limit - counter.count),
      resetAtMs: counter.resetAtMs,
    };
  }
}

export type CentralLogEntry = {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  event: 'request.completed' | 'security.denied' | 'dependency.failure';
  service: 'api';
  environment: 'local' | 'staging' | 'production';
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  errorCode?: string;
};

export type CentralAppOptions = {
  features?: CentralFeatureDependencies;
  database?: CentralDatabaseAdapter;
  environment?: 'local' | 'staging' | 'production';
  corsOrigins?: readonly string[];
  rateLimitStore?: CentralRateLimitStore;
  requireDistributedRateLimitStore?: boolean;
  clientIdentityResolver?: (
    context: Context,
  ) => { clientId: string; ipAddress: string } | null;
  logSink?: (entry: CentralLogEntry) => void;
};

const uuidV7Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const protectedPathPatterns = [
  /^\/api\/v1\/members\/(?!promote(?:\/|$))([^/]+)(?:\/retire)?$/,
  /^\/api\/v1\/events\/([^/]+)(?:\/attendance(?:\/summary)?)?$/,
  /^\/api\/v1\/board-members\/([^/]+)$/,
  /^\/api\/v1\/orders\/([^/]+)(?:\/.*)?$/,
  /^\/api\/v1\/uploads\/([^/]+)(?:\/.*)?$/,
  /^\/api\/v1\/line\/notifications\/([^/]+)\/retry$/,
  /^\/api\/v1\/ride-plans\/([^/]+)(?:\/.*)?$/,
  /^\/api\/v1\/announcements\/([^/]+)(?:\/.*)?$/,
];

function safeRequestId(value: string | null | undefined): string {
  const candidate = value?.trim();
  if (
    candidate &&
    candidate.length <= 128 &&
    [...candidate].every((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
  )
    return candidate;
  return crypto.randomUUID();
}

function errorResponse(
  context: Context<CentralApiEnv>,
  status: 400 | 401 | 403 | 404 | 429 | 500 | 503,
  code: string,
  message: string,
) {
  return context.json(
    {
      error: {
        code,
        message,
        details: {},
        requestId: context.get('requestId'),
      },
    },
    status,
  );
}

function pathOf(context: Context): string {
  return new URL(context.req.url).pathname;
}

function isTeamSelectionPath(path: string): boolean {
  return (
    path === '/api/v1/auth/teams' || path.startsWith('/api/v1/auth/teams/')
  );
}

function routeTemplate(path: string): string {
  return path.replace(
    /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\/|$)/gi,
    '/:id',
  );
}

export function createCentralRequestContextMiddleware(): MiddlewareHandler<CentralApiEnv> {
  return async (context, next) => {
    const requestId = safeRequestId(context.req.header('x-request-id'));
    context.set('requestId', requestId);
    context.header('x-request-id', requestId);
    await next();
    context.header('x-request-id', requestId);
  };
}

// PR #29の共通CORS契約を中央middlewareの認証前へ接続する。
export function createCentralCorsMiddleware(
  origins: readonly string[],
): MiddlewareHandler<CentralApiEnv> {
  return createCorsMiddleware({ origins });
}

// Supabase JWTとactive membershipを一度解決し、HTTP入力からtenantやroleを受け取らない。
export function createCentralAuthMiddleware(
  verifyToken: TokenVerifier | undefined,
  membershipRepository: CentralMembershipRepository | undefined,
  isPublicWebhook: (context: Context) => boolean,
): MiddlewareHandler<CentralApiEnv> {
  return async (context, next) => {
    if (isPublicWebhook(context)) return next();
    const token = extractBearerToken(
      context.req.header('authorization') ?? null,
    );
    const bearerOnlyTeamSelection = isTeamSelectionPath(pathOf(context));
    if (!verifyToken || (!membershipRepository && !bearerOnlyTeamSelection))
      return errorResponse(
        context,
        503,
        'AUTH_NOT_CONFIGURED',
        '認証・所属解決が設定されていません。',
      );
    if (!token)
      return errorResponse(context, 401, 'UNAUTHENTICATED', '認証が必要です。');
    try {
      const claims = await verifyToken(token);
      if (claims.expiresAt <= Math.floor(Date.now() / 1000))
        return errorResponse(
          context,
          401,
          'UNAUTHENTICATED',
          '認証の有効期限が切れています。',
        );
      context.set('authUserId', claims.userId);
      if (isTeamSelectionPath(pathOf(context))) return next();
      if (!membershipRepository)
        return errorResponse(
          context,
          503,
          'AUTH_NOT_CONFIGURED',
          '認証・所属解決が設定されていません。',
        );
      const membership = await membershipRepository.findActiveByUserId(
        claims.userId,
      );
      if (!membership)
        return errorResponse(
          context,
          403,
          'FORBIDDEN',
          '利用可能な所属がありません。',
        );
      context.set('auth', { userId: claims.userId, membership });
      await next();
    } catch {
      return errorResponse(
        context,
        401,
        'UNAUTHENTICATED',
        '認証情報を確認できません。',
      );
    }
  };
}

// resource IDをroute入口でUUIDv7へ限定し、feature固有repositoryへ不正なIDを渡さない。
export function createCentralPathValidationMiddleware(): MiddlewareHandler<CentralApiEnv> {
  return async (context, next) => {
    const path = pathOf(context);
    for (const pattern of protectedPathPatterns) {
      const match = pattern.exec(path);
      if (match && !uuidV7Pattern.test(match[1] ?? ''))
        return errorResponse(
          context,
          400,
          'VALIDATION_ERROR',
          '対象IDはUUIDv7形式で指定してください。',
        );
    }
    await next();
  };
}

// 認証済み利用者はtenantとuser、Webhookは信頼できるgatewayのclient identityで制限する。
export function createCentralRateLimitMiddleware(options: {
  store?: CentralRateLimitStore;
  requireDistributed?: boolean;
  clientIdentityResolver?: CentralAppOptions['clientIdentityResolver'];
}): MiddlewareHandler<CentralApiEnv> {
  const store: CentralRateLimitStore =
    options.store ?? new InMemoryCentralRateLimitStore();
  if (options.requireDistributed && !store.distributed)
    throw new Error(
      'stagingとproductionでは分散rate-limit storeの接続が必要です。',
    );

  const resolveIdentity = async (
    context: Context,
  ): Promise<RateLimitIdentity | null> => {
    if (pathOf(context) === '/api/v1/line/webhook') {
      const identity = options.clientIdentityResolver?.(context);
      return identity ? { kind: 'client', ...identity } : null;
    }
    const auth = context.get('auth') as CentralAuth | undefined;
    const authUserId = context.get('authUserId');
    return auth
      ? {
          kind: 'user',
          tenantId: auth.membership.tenantId,
          userId: auth.userId,
        }
      : authUserId
        ? {
            kind: 'user',
            tenantId: 'team-selection',
            userId: authUserId,
          }
        : null;
  };
  const authenticated = createRateLimitMiddleware({
    scope: 'authenticated',
    limit: 60,
    windowMs: 60_000,
    keyResolver: resolveIdentity,
    store,
  });
  const uploads = createRateLimitMiddleware({
    scope: 'upload-session',
    limit: 10,
    windowMs: 60_000,
    keyResolver: resolveIdentity,
    store,
  });
  return (context, next) =>
    pathOf(context).startsWith('/api/v1/uploads')
      ? uploads(context, next)
      : authenticated(context, next);
}

const centralSuccessPath =
  /^\/api\/v1\/(session|members|events|board-members|orders|uploads|line|ride-plans|announcements|auth\/teams)(?:\/.*)?$/;

function createCentralResponseContracts(): ResponseContract[] {
  const contracts: ResponseContract[] = [];
  for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
    for (const status of [200, 201, 202])
      contracts.push({
        method,
        path: centralSuccessPath,
        status,
        schema: featureEnvelopeResponseSchema,
      });
  return contracts;
}

// PR #29のruntime response registryへ中央で公開する全featureのJSON envelopeを登録する。
export function createCentralResponseValidationMiddleware(): MiddlewareHandler<CentralApiEnv> {
  return createResponseContractMiddleware({
    contracts: createCentralResponseContracts(),
    onViolation: () => undefined,
  });
}

// PR #29のstructured loggerへ接続し、秘密、本文、query、IP、tenant、userを記録しない。
export function createCentralRequestLoggerMiddleware(options: {
  environment: 'local' | 'staging' | 'production';
  sink?: (entry: CentralLogEntry) => void;
}): MiddlewareHandler<CentralApiEnv> {
  const logger = createStructuredLogger(
    options.sink
      ? (line) => {
          try {
            options.sink?.(JSON.parse(line) as CentralLogEntry);
          } catch {
            // 構造化ログの解析失敗でAPIの結果を変更しない。
          }
        }
      : undefined,
  );
  return createRequestLoggerMiddleware({
    logger,
    environment: options.environment,
    pathResolver: (context) => routeTemplate(pathOf(context)),
  });
}

function createUnavailableFeatureApp(
  feature: string,
  paths: readonly string[],
): Hono<CentralApiEnv> {
  const app = new (Hono as new () => Hono<CentralApiEnv>)();
  const handler = (context: Context<CentralApiEnv>) =>
    errorResponse(
      context,
      503,
      'FEATURE_NOT_CONFIGURED',
      `${feature}の中央依存性が設定されていません。`,
    );
  for (const path of paths) {
    app.all(path, handler);
    app.all(`${path}/*`, handler);
  }
  return app;
}

// 各feature appの認証・契約・認可コードを変更せず、共有依存性だけを中央から注入する。
export function mountCentralFeatureRoutes(
  app: Hono<CentralApiEnv>,
  input: {
    verifyToken?: TokenVerifier;
    membershipRepository?: CentralMembershipRepository;
    features?: CentralFeatureDependencies;
  },
) {
  const membershipRepository = input.membershipRepository;
  const common = {
    verifyToken: input.verifyToken,
    membershipRepository,
  };

  if (input.features?.events)
    app.route(
      '/api/v1/events',
      createEventsApp({
        verifyToken: input.verifyToken,
        membershipRepository: membershipRepository as NonNullable<
          typeof membershipRepository
        >,
        eventRepository: input.features.events.repository,
      }),
    );
  else
    app.route('/', createUnavailableFeatureApp('FS-EVT', ['/api/v1/events']));

  if (input.features?.boardContact)
    app.route(
      '/',
      createBoardContactApp({
        ...common,
        boardContactRepository: input.features.boardContact.repository,
      }),
    );
  else
    app.route(
      '/',
      createUnavailableFeatureApp('FS-BRD', ['/api/v1/board-members']),
    );

  if (input.features?.orders)
    app.route(
      '/',
      createOrdersPaymentsApp({
        ...common,
        ordersRepository: input.features.orders.repository,
      }),
    );
  else
    app.route('/', createUnavailableFeatureApp('FS-ORD', ['/api/v1/orders']));

  if (input.features?.attachments)
    app.route(
      '/',
      createAttachmentApp({
        ...common,
        attachmentRepository: input.features.attachments.repository,
        storage: input.features.attachments.storage,
      }),
    );
  else
    app.route('/', createUnavailableFeatureApp('FS-FIL', ['/api/v1/uploads']));

  if (input.features?.line)
    app.route(
      '/',
      createLineNotificationApp({
        verifyToken: input.verifyToken,
        findActiveMembership: membershipRepository?.findActiveByUserId,
        service: input.features.line.service,
      }),
    );
  else app.route('/', createUnavailableFeatureApp('FS-NOT', ['/api/v1/line']));

  if (input.features?.ride)
    registerRideRoutes(app as unknown as RideRouteApp, {
      service: input.features.ride.service,
      getAuth: (context) => {
        const auth = context.get('auth') as CentralAuth | undefined;
        return auth
          ? {
              tenantId: auth.membership.tenantId,
              userId: auth.userId,
              role: auth.membership.role,
            }
          : null;
      },
    });
  else
    app.route(
      '/',
      createUnavailableFeatureApp('FS-RIDE', ['/api/v1/ride-plans']),
    );

  if (input.features?.bulletinBoard)
    app.route(
      '/',
      createBulletinBoardApp({
        verifyToken: input.verifyToken,
        membershipRepository,
        bulletinBoardRepository: input.features.bulletinBoard.repository,
      }),
    );
  else
    app.route(
      '/',
      createUnavailableFeatureApp('FS-ANN', ['/api/v1/announcements']),
    );

  if (input.features?.authTeamSelection)
    app.route(
      '/api/v1/auth',
      createAuthTeamSelectionApp({
        verifyToken: input.verifyToken,
        repository: input.features.authTeamSelection.repository,
      }),
    );
  else
    app.route(
      '/',
      createUnavailableFeatureApp('FS-AUTH', ['/api/v1/auth/teams']),
    );
}

// DB schemaとmigrationが中央統合されるまで、Prisma clientを偽のfeature repositoryへ変換しない。
export function createCentralDatabaseAdapter(
  client: unknown,
): CentralDatabaseAdapter {
  return {
    client,
    featureSchemaReady: false,
    unavailableReason:
      '各featureのPrisma schema、migration、RLS、grantを中央統合するまでfeature repositoryを有効化しません。',
  };
}
