import { createHash } from 'node:crypto';
import { extractBearerToken, type TokenVerifier } from '@cocolo/auth';
import type { MemberRole } from '@cocolo/contracts/member';
import type { EventRepository } from '@cocolo/db/events';
import type { OrdersRepository } from '@cocolo/db/orders';
import type { LineNotificationService } from './features/line-notifications/line-service.js';
import { createLineNotificationApp } from './features/line-notifications/routes.js';
import { createAttachmentApp } from './features/attachments/attachment-app.js';
import type { AttachmentStorage } from './features/attachments/attachment-storage.js';
import { createBoardContactApp, type BoardContactRepository } from './features/board-contact/index.js';
import { createEventsApp } from './features/events/event-api.js';
import { createOrdersPaymentsApp } from './features/orders-payments/orders-payments-app.js';
import { registerRideRoutes } from './features/ride-operations/ride-routes.js';
import type { RideService } from './features/ride-operations/ride-service.js';
import type { AttachmentRepository } from '@cocolo/domain/attachment';
import type { Context, Hono, MiddlewareHandler } from 'hono';

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

export type CentralRateLimitStore = {
  consume: (
    input: CentralRateLimitConsumeInput,
  ) =>
    | { allowed: boolean; remaining: number; resetAtMs: number }
    | Promise<{ allowed: boolean; remaining: number; resetAtMs: number }>;
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
  /^\/api\/v1\/members\/([^/]+)(?:\/retire)?$/,
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

function routeTemplate(path: string): string {
  return path.replace(
    /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\/|$)/gi,
    '/:id',
  );
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeOrigin(value: string): string {
  const url = new URL(value.trim());
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('CORS allowlistにはoriginだけを指定してください。');
  return `${url.protocol}//${url.host}`;
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

// 認証前にoriginを検査し、allowlist外のブラウザ経路を認証処理へ到達させない。
export function createCentralCorsMiddleware(
  origins: readonly string[],
): MiddlewareHandler<CentralApiEnv> {
  if (!origins.length) throw new Error('CORS allowlistが空です。');
  const allowlist = new Set(
    origins.map((origin) => {
      if (origin.trim() === '*' || origin.trim() === 'null')
        throw new Error('CORS allowlistにワイルドカードを指定できません。');
      return normalizeOrigin(origin);
    }),
  );
  const methods = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'];
  const headers = ['Authorization', 'Content-Type', 'Idempotency-Key', 'If-Match'];

  return async (context, next) => {
    const origin = context.req.header('origin');
    if (!origin) return next();
    let normalized: string;
    try {
      normalized = normalizeOrigin(origin);
    } catch {
      return errorResponse(
        context,
        403,
        'CORS_ORIGIN_DENIED',
        '許可されていないCross-Originリクエストです。',
      );
    }
    if (!allowlist.has(normalized))
      return errorResponse(
        context,
        403,
        'CORS_ORIGIN_DENIED',
        '許可されていないCross-Originリクエストです。',
      );
    if (context.req.method === 'OPTIONS') {
      const method = context.req.header('access-control-request-method');
      const requestedHeaders = (context.req.header('access-control-request-headers') ?? '')
        .split(',')
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean);
      if (!method || !methods.includes(method.toUpperCase()))
        return errorResponse(
          context,
          403,
          'CORS_METHOD_DENIED',
          '許可されていないCross-Originリクエストです。',
        );
      if (
        requestedHeaders.some(
          (header) => !headers.some((allowed) => allowed.toLowerCase() === header),
        )
      )
        return errorResponse(
          context,
          403,
          'CORS_HEADER_DENIED',
          '許可されていないCross-Originリクエストです。',
        );
      context.header('Access-Control-Allow-Origin', normalized);
      context.header('Access-Control-Allow-Methods', methods.join(', '));
      context.header('Access-Control-Allow-Headers', headers.join(', '));
      context.header('Access-Control-Max-Age', '600');
      context.header('Vary', 'Origin');
      return context.body(null, 204);
    }
    context.header('Access-Control-Allow-Origin', normalized);
    context.header('Access-Control-Expose-Headers', 'X-Request-Id, Retry-After');
    context.header('Vary', 'Origin');
    await next();
  };
}

// Supabase JWTとactive membershipを一度解決し、HTTP入力からtenantやroleを受け取らない。
export function createCentralAuthMiddleware(
  verifyToken: TokenVerifier | undefined,
  membershipRepository: CentralMembershipRepository | undefined,
  isPublicWebhook: (context: Context) => boolean,
): MiddlewareHandler<CentralApiEnv> {
  return async (context, next) => {
    if (isPublicWebhook(context)) return next();
    const token = extractBearerToken(context.req.header('authorization') ?? null);
    if (!verifyToken || !membershipRepository)
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

function rateLimitError(
  context: Context<CentralApiEnv>,
  status: 429 | 503,
  code: string,
) {
  return errorResponse(
    context,
    status,
    code,
    status === 429
      ? 'リクエスト数の上限を超えました。'
      : 'レート制限を適用できないため処理を停止しました。',
  );
}

// 認証済み利用者はtenantとuser、Webhookは信頼できるgatewayのclient identityで制限する。
export function createCentralRateLimitMiddleware(options: {
  store?: CentralRateLimitStore;
  requireDistributed?: boolean;
  clientIdentityResolver?: CentralAppOptions['clientIdentityResolver'];
}): MiddlewareHandler<CentralApiEnv> {
  const store = options.store ?? new InMemoryCentralRateLimitStore();
  if (options.requireDistributed && !store.distributed)
    throw new Error(
      'stagingとproductionでは分散rate-limit storeの接続が必要です。',
    );

  return async (context, next) => {
    const webhook = pathOf(context) === '/api/v1/line/webhook';
    const auth = context.get('auth');
    const identity = webhook
      ? options.clientIdentityResolver?.(context)
      : auth
        ? {
            clientId: auth.membership.tenantId,
            ipAddress: auth.userId,
          }
        : null;
    if (!identity)
      return rateLimitError(
        context,
        503,
        'RATE_LIMIT_IDENTITY_UNAVAILABLE',
      );
    const limit = pathOf(context).startsWith('/api/v1/uploads') ? 10 : 60;
    const windowMs = 60_000;
    let result: Awaited<ReturnType<CentralRateLimitStore['consume']>>;
    try {
      result = await store.consume({
        key: hash(`${identity.clientId}:${identity.ipAddress}:${pathOf(context)}`),
        limit,
        windowMs,
        nowMs: Date.now(),
      });
    } catch {
      return rateLimitError(context, 503, 'RATE_LIMIT_UNAVAILABLE');
    }
    context.header('X-RateLimit-Limit', String(limit));
    context.header('X-RateLimit-Remaining', String(result.remaining));
    context.header('X-RateLimit-Reset', String(Math.ceil(result.resetAtMs / 1000)));
    if (!result.allowed) {
      context.header(
        'Retry-After',
        String(Math.max(1, Math.ceil((result.resetAtMs - Date.now()) / 1000))),
      );
      return rateLimitError(context, 429, 'RATE_LIMIT_EXCEEDED');
    }
    await next();
  };
}

function isJsonResponse(response: Response) {
  return response.headers.get('content-type')?.toLowerCase().includes('json') ?? false;
}

function validErrorPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !('error' in value)) return false;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return false;
  const payload = error as Record<string, unknown>;
  return (
    typeof payload.code === 'string' &&
    payload.code.length > 0 &&
    payload.code.length <= 128 &&
    typeof payload.message === 'string' &&
    payload.message.length > 0 &&
    payload.message.length <= 512 &&
    'details' in payload &&
    typeof payload.requestId === 'string' &&
    safeRequestId(payload.requestId) === payload.requestId
  );
}

function validSuccessPayload(value: unknown): boolean {
  return !!value && typeof value === 'object' && 'data' in value;
}

function internalResponse(context: Context<CentralApiEnv>) {
  const requestId = context.get('requestId');
  context.res = new Response(
    JSON.stringify({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: '公開レスポンスを検証できませんでした。',
        details: {},
        requestId,
      },
    }),
    {
      status: 500,
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'x-request-id': requestId,
      },
    },
  );
}

// JSONの共通envelopeを送信前に検証し、未登録の成功レスポンスや内部情報の直返しを止める。
export function createCentralResponseValidationMiddleware(): MiddlewareHandler<CentralApiEnv> {
  return async (context, next) => {
    await next();
    const path = pathOf(context);
    if (!path.startsWith('/api/v1') || context.res.status === 204 || !isJsonResponse(context.res))
      return;
    let body: unknown;
    try {
      body = await context.res.clone().json();
    } catch {
      internalResponse(context);
      return;
    }
    const valid =
      context.res.status >= 400
        ? validErrorPayload(body)
        : validSuccessPayload(body);
    if (!valid) internalResponse(context);
  };
}

// 秘密、本文、query、IP、tenant、userをログへ出さず、運用に必要な固定項目だけを出力する。
export function createCentralRequestLoggerMiddleware(options: {
  environment: 'local' | 'staging' | 'production';
  sink?: (entry: CentralLogEntry) => void;
}): MiddlewareHandler<CentralApiEnv> {
  const sink = options.sink ?? ((entry) => console.log(JSON.stringify(entry)));
  return async (context, next) => {
    const startedAt = Date.now();
    let failed = false;
    try {
      await next();
    } catch (error) {
      void error;
      failed = true;
      throw error;
    } finally {
      try {
        sink({
          timestamp: new Date().toISOString(),
          level: failed || context.res.status >= 500 ? 'error' : context.res.status >= 400 ? 'warn' : 'info',
          event: failed
            ? 'dependency.failure'
            : [401, 403, 429].includes(context.res.status)
              ? 'security.denied'
              : 'request.completed',
          service: 'api',
          environment: options.environment,
          requestId: safeRequestId(context.get('requestId')),
          method: context.req.method,
          path: routeTemplate(pathOf(context)),
          status: failed ? 500 : context.res.status,
          durationMs: Math.max(0, Date.now() - startedAt),
        });
      } catch {
        // ログsink障害でAPIの結果を変更しない。
      }
    }
  };
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
        membershipRepository: membershipRepository as NonNullable<typeof membershipRepository>,
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
    app.route('/', createUnavailableFeatureApp('FS-BRD', ['/api/v1/board-members']));

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
  else
    app.route('/', createUnavailableFeatureApp('FS-NOT', ['/api/v1/line']));

  if (input.features?.ride)
    registerRideRoutes(app, {
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
    app.route('/', createUnavailableFeatureApp('FS-RIDE', ['/api/v1/ride-plans']));

  // FS-ANNのfeature appは指定起点へ未取り込みのため、偽の成功応答を作らず明示的に停止する。
  app.route(
    '/',
    createUnavailableFeatureApp('FS-ANN', ['/api/v1/announcements']),
  );
}

// DB schemaとmigrationが中央統合されるまで、Prisma clientを偽のfeature repositoryへ変換しない。
export function createCentralDatabaseAdapter(client: unknown): CentralDatabaseAdapter {
  return {
    client,
    featureSchemaReady: false,
    unavailableReason:
      '各featureのPrisma schema、migration、RLS、grantを中央統合するまでfeature repositoryを有効化しません。',
  };
}
