import { extractBearerToken, type TokenVerifier } from '@cocolo/auth';
import {
  invitationAcceptResponseSchema,
  invitationCreateResponseSchema,
  invitationListResponseSchema,
  invitationResponseSchema,
} from '@cocolo/contracts/auth-invitation';
import {
  selectedTeamHeaderName,
  teamListResponseSchema,
  teamSelectionResponseSchema,
  uuidv7Schema,
} from '@cocolo/contracts/auth-team-selection';
import {
  boardContactCopyYearResponseSchema,
  boardContactListResponseSchemaForRole,
  boardContactManagerMutationResponseSchema,
} from '@cocolo/contracts/board-contact-response';
import {
  announcementListResponseSchema,
  announcementReadResponseSchema,
  announcementResponseEnvelopeSchema,
  announcementUnreadResponseSchema,
} from '@cocolo/contracts/bulletin-board-response';
import { featureContractResponseSchema } from '@cocolo/contracts/feature-contract';
import {
  lineConnectResponseSchema,
  lineDisconnectResponseSchema,
  lineEnqueueResponseSchema,
  lineNotificationEnvelopeResponseSchema,
  lineStatusResponseSchema,
  lineWebhookResponseSchema,
} from '@cocolo/contracts/line';
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
import type { StructuredLogEntry } from '@cocolo/contracts/observability';
import {
  orderCampaignListResponseSchema,
  orderCampaignResponseEnvelopeSchema,
  orderEntryListResponseSchemaForRole,
  orderEntryResponseEnvelopeSchemaForRole,
  orderProductResponseEnvelopeSchema,
  orderSummaryResponseEnvelopeSchema,
} from '@cocolo/contracts/orders-response';
import {
  rideAssignmentResponseEnvelopeSchema,
  rideDispatchResponseEnvelopeSchema,
  rideDisplayNameResponseEnvelopeSchema,
  rideMatchResponseSchema,
  rideMetricsResponseEnvelopeSchema,
  rideOfferResponseEnvelopeSchema,
  ridePlanListResponseSchema,
  ridePlanResponseEnvelopeSchema,
  rideRequestResponseEnvelopeSchema,
  rideSnapshotResponseEnvelopeSchema,
} from '@cocolo/contracts/ride-response';
import {
  attendanceListResponseSchema,
  attendanceResponseSchema,
  attendanceSummaryResponseSchema,
  authContextResponseSchema,
  eventListResponseSchema,
  eventMutationResponseSchema,
  featureEnvelopeResponseSchema,
  lineDeliveryResponseSchema,
  memberListResponseSchemaForRole,
  memberMutationResponseSchemaForRole,
  promotionResponseSchema,
  systemContextResponseSchema,
} from '@cocolo/contracts/runtime-response';
import {
  systemAnnouncementListResponseSchema,
  systemAnnouncementResponseSchema,
  systemFeatureListResponseSchema,
  systemFeatureResponseSchema,
} from '@cocolo/contracts/system-admin';
import {
  uploadCleanupResponseSchema,
  uploadCompleteResponseSchema,
  uploadDownloadResponseSchema,
  uploadExpiredCleanupResponseSchema,
  uploadSessionResponseSchema,
} from '@cocolo/contracts/upload';
import type { LineDeliveryProducer, SystemAdminRepository } from '@cocolo/db';
import type { EventRepository } from '@cocolo/db/events';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import {
  type CentralFeatureRoutes,
  mountCentralFeatureRoutes,
} from './central-feature-routes.js';
import { createEventsApp } from './features/events/event-api.js';
import { createFeatureEntitlementMiddleware } from './features/feature-contract/feature-contract-app.js';
import { createSystemAdminApp } from './features/system-admin/system-admin-app.js';
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
import { resolveRequestId } from './security/request-id.js';
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
  eventRepository?: EventRepository;
  systemAdminRepository?: SystemAdminRepository;
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
  centralFeatures?: CentralFeatureRoutes;
};

export type ApiEnv = {
  Variables: {
    requestId: string;
    authUserId: string;
    authProviders: Array<'google' | 'line'>;
    authProviderSubjects: Partial<Record<'google' | 'line', string>>;
    auth: {
      userId: string;
      membership: MembershipContext;
    };
    systemAuth: {
      userId: string;
    };
  };
};

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
  if (managerRoles.has(role))
    return {
      ...common,
      ageGroup: member.ageGroup,
      createdAt:
        member.createdAt instanceof Date
          ? member.createdAt.toISOString()
          : member.createdAt,
    };
  throw new Error('部員公開projectionのroleが不正です。');
}

// APIの依存性と認証middlewareを組み立て、tenant/roleは認証後の所属解決結果だけを利用する。
export function createApp(options: AppOptions = {}): Hono<ApiEnv> {
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
    const requestId = resolveRequestId(c.req.raw);
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
      path: /^\/api\/v1\/auth\/invitations$/,
      status: 200,
      schema: invitationListResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/auth\/invitations$/,
      status: 201,
      schema: invitationCreateResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/auth\/invitations\/[^/]+\/revoke$/,
      status: 200,
      schema: invitationResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/auth\/invitations\/accept$/,
      status: 200,
      schema: invitationAcceptResponseSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/feature-contract$/,
      status: 200,
      schema: featureContractResponseSchema,
    },
    {
      method: 'PATCH',
      path: /^\/api\/v1\/feature-contract\/[^/]+$/,
      status: 200,
      schema: featureContractResponseSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/system\/announcements$/,
      status: 200,
      schema: systemAnnouncementListResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/system\/announcements$/,
      status: 201,
      schema: systemAnnouncementResponseSchema,
    },
    {
      method: 'PATCH',
      path: /^\/api\/v1\/system\/announcements\/[^/]+$/,
      status: 200,
      schema: systemAnnouncementResponseSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/system\/features$/,
      status: 200,
      schema: systemFeatureListResponseSchema,
    },
    {
      method: 'PATCH',
      path: /^\/api\/v1\/system\/features\/[^/]+$/,
      status: 200,
      schema: systemFeatureResponseSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/orders$/,
      status: 200,
      schema: orderCampaignListResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/orders$/,
      status: 201,
      schema: orderCampaignResponseEnvelopeSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/orders\/[^/]+$/,
      status: 200,
      schema: orderCampaignResponseEnvelopeSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/orders\/[^/]+\/products$/,
      status: 201,
      schema: orderProductResponseEnvelopeSchema,
    },
    {
      method: 'PATCH',
      path: /^\/api\/v1\/orders\/[^/]+\/status$/,
      status: 200,
      schema: orderCampaignResponseEnvelopeSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/orders\/[^/]+\/entries$/,
      status: 200,
      schema: (c) =>
        orderEntryListResponseSchemaForRole(
          c.get('auth')?.membership.role ?? 'guardian',
        ),
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/orders\/[^/]+\/entries$/,
      status: 201,
      schema: (c) =>
        orderEntryResponseEnvelopeSchemaForRole(
          c.get('auth')?.membership.role ?? 'guardian',
        ),
    },
    {
      method: 'PATCH',
      path: /^\/api\/v1\/orders\/[^/]+\/entries\/[^/]+\/payment$/,
      status: 200,
      schema: (c) =>
        orderEntryResponseEnvelopeSchemaForRole(
          c.get('auth')?.membership.role ?? 'guardian',
        ),
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/orders\/[^/]+\/summary$/,
      status: 200,
      schema: orderSummaryResponseEnvelopeSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/orders\/[^/]+\/unpaid$/,
      status: 200,
      schema: (c) =>
        orderEntryListResponseSchemaForRole(
          c.get('auth')?.membership.role ?? 'guardian',
        ),
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/board-members$/,
      status: 200,
      schema: (c) =>
        boardContactListResponseSchemaForRole(
          c.get('auth')?.membership.role ?? 'guardian',
        ),
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/board-members$/,
      status: 201,
      schema: boardContactManagerMutationResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/board-members\/copy-year$/,
      status: 201,
      schema: boardContactCopyYearResponseSchema,
    },
    {
      method: 'PATCH',
      path: /^\/api\/v1\/board-members\/[^/]+$/,
      status: 200,
      schema: boardContactManagerMutationResponseSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/announcements$/,
      status: 200,
      schema: announcementListResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/announcements$/,
      status: 201,
      schema: announcementResponseEnvelopeSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/announcements\/[^/]+$/,
      status: 200,
      schema: announcementResponseEnvelopeSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/announcements\/[^/]+\/read$/,
      status: 200,
      schema: announcementReadResponseSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/announcements\/[^/]+\/unread$/,
      status: 200,
      schema: announcementUnreadResponseSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/auth\/teams$/,
      status: 200,
      schema: teamListResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/auth\/teams\/select$/,
      status: 200,
      schema: teamSelectionResponseSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/line\/status$/,
      status: 200,
      schema: lineStatusResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/line\/connect$/,
      status: 201,
      schema: lineConnectResponseSchema,
    },
    {
      method: 'DELETE',
      path: /^\/api\/v1\/line\/connect$/,
      status: 200,
      schema: lineDisconnectResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/line\/webhook$/,
      status: 200,
      schema: lineWebhookResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/line\/notifications$/,
      status: 200,
      schema: lineEnqueueResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/line\/notifications$/,
      status: 202,
      schema: lineEnqueueResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/line\/notifications\/[^/]+\/retry$/,
      status: 200,
      schema: lineNotificationEnvelopeResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/uploads$/,
      status: 201,
      schema: uploadSessionResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/uploads\/cleanup-expired$/,
      status: 200,
      schema: uploadExpiredCleanupResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/uploads\/[^/]+\/complete$/,
      status: 200,
      schema: uploadCompleteResponseSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/uploads\/[^/]+\/download$/,
      status: 200,
      schema: uploadDownloadResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/uploads\/[^/]+\/cleanup$/,
      status: 200,
      schema: uploadCleanupResponseSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/members$/,
      status: 200,
      schema: (c) =>
        memberListResponseSchemaForRole(
          c.get('auth')?.membership.role ?? 'guardian',
        ),
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/members$/,
      status: 201,
      schema: (c) =>
        memberMutationResponseSchemaForRole(
          c.get('auth')?.membership.role ?? 'guardian',
        ),
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/events\/[^/]+$/,
      status: 200,
      schema: eventMutationResponseSchema,
    },
    {
      method: 'PATCH',
      path: /^\/api\/v1\/members\/[^/]+$/,
      status: 200,
      schema: (c) =>
        memberMutationResponseSchemaForRole(
          c.get('auth')?.membership.role ?? 'guardian',
        ),
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/members\/[^/]+\/retire$/,
      status: 200,
      schema: (c) =>
        memberMutationResponseSchemaForRole(
          c.get('auth')?.membership.role ?? 'guardian',
        ),
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
    {
      method: 'POST',
      path: /^\/api\/v1\/notifications\/line\/[^/]+\/retry$/,
      status: 202,
      schema: lineDeliveryResponseSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/events$/,
      status: 200,
      schema: eventListResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/events$/,
      status: 201,
      schema: eventMutationResponseSchema,
    },
    {
      method: 'PATCH',
      path: /^\/api\/v1\/events\/[^/]+$/,
      status: 200,
      schema: eventMutationResponseSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/events\/[^/]+\/attendance$/,
      status: 200,
      schema: attendanceListResponseSchema,
    },
    {
      method: 'PUT',
      path: /^\/api\/v1\/events\/[^/]+\/attendance$/,
      status: 200,
      schema: attendanceResponseSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/events\/[^/]+\/attendance\/summary$/,
      status: 200,
      schema: attendanceSummaryResponseSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/auth\/context$/,
      status: 200,
      schema: authContextResponseSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/system\/context$/,
      status: 200,
      schema: systemContextResponseSchema,
    },
    {
      method: 'PATCH',
      path: /^\/api\/v1\/ride-profile\/display-name$/,
      status: 200,
      schema: rideDisplayNameResponseEnvelopeSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/ride-plans$/,
      status: 200,
      schema: ridePlanListResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/ride-plans$/,
      status: 201,
      schema: ridePlanResponseEnvelopeSchema,
    },
    {
      method: 'PATCH',
      path: /^\/api\/v1\/ride-plans\/[^/]+$/,
      status: 200,
      schema: ridePlanResponseEnvelopeSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/ride-plans\/[^/]+\/status$/,
      status: 200,
      schema: ridePlanResponseEnvelopeSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/ride-plans\/[^/]+$/,
      status: 200,
      schema: rideSnapshotResponseEnvelopeSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/ride-plans\/[^/]+\/offers$/,
      status: 201,
      schema: rideOfferResponseEnvelopeSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/ride-plans\/[^/]+\/requests$/,
      status: 201,
      schema: rideRequestResponseEnvelopeSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/ride-plans\/[^/]+\/match$/,
      status: 200,
      schema: rideMatchResponseSchema,
    },
    {
      method: 'POST',
      path: /^\/api\/v1\/ride-plans\/[^/]+\/assignments$/,
      status: 201,
      schema: rideAssignmentResponseEnvelopeSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/ride-plans\/[^/]+\/dispatch$/,
      status: 200,
      schema: rideDispatchResponseEnvelopeSchema,
    },
    {
      method: 'GET',
      path: /^\/api\/v1\/ride-plans\/[^/]+\/metrics$/,
      status: 200,
      schema: rideMetricsResponseEnvelopeSchema,
    },
  ];
  for (const path of [
    /^\/api\/v1\/auth\/teams(?:\/.*)?$/,
    /^\/api\/v1\/board-members(?:\/.*)?$/,
    /^\/api\/v1\/announcements(?:\/.*)?$/,
    /^\/api\/v1\/line(?:\/.*)?$/,
    /^\/api\/v1\/ride-plans(?:\/.*)?$/,
    /^\/api\/v1\/uploads(?:\/.*)?$/,
    /^\/api\/v1\/orders(?:\/.*)?$/,
  ])
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE'])
      for (const status of [200, 201, 202])
        responseContracts.push({
          method,
          path,
          status,
          schema: featureEnvelopeResponseSchema,
        });
  app.use(
    '*',
    createResponseContractMiddleware({
      contracts: responseContracts,
      allowedNonJson: [
        {
          method: 'OPTIONS',
          path: /^\/api\/v1(?:\/.*)?$/,
          status: 204,
        },
        {
          method: 'DELETE',
          path: /^\/api\/v1\/board-members\/[^/]+$/,
          status: 204,
        },
        {
          method: 'GET',
          path: /^\/api\/v1\/orders\/[^/]+\/export\.csv$/,
          status: 200,
        },
      ],
      onViolation: (violation) => {
        logger.write({
          timestamp: new Date().toISOString(),
          level: 'error',
          event: 'dependency.failure',
          service: 'api',
          environment:
            options.observability?.environment ?? rateLimitEnvironment,
          requestId: violation.requestId,
          method: violation.method as StructuredLogEntry['method'],
          path: violation.path,
          status: violation.status,
          durationMs: 0,
          errorCode: 'RESPONSE_CONTRACT_VIOLATION',
        });
      },
    }),
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
  const isPublicLineWebhook = (c: Context<ApiEnv>) =>
    options.centralFeatures?.line?.webhook === true &&
    c.req.method === 'POST' &&
    c.req.path === '/api/v1/line/webhook';

  const authenticate: MiddlewareHandler<ApiEnv> = async (c, next) => {
    if (isPublicLineWebhook(c)) return next();
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

    let claims: Awaited<ReturnType<NonNullable<AppOptions['verifyToken']>>>;
    try {
      claims = await options.verifyToken(token);
    } catch {
      return errorResponse(
        c,
        401,
        'UNAUTHENTICATED',
        '認証情報を確認できません。',
      );
    }
    if (claims.expiresAt <= Math.floor(Date.now() / 1000))
      return errorResponse(
        c,
        401,
        'UNAUTHENTICATED',
        '認証の有効期限が切れています。',
      );
    let membership: MembershipContext | null;
    try {
      const selectedTeamId = c.req.header(selectedTeamHeaderName);
      if (selectedTeamId && options.centralFeatures?.authTeamSelection) {
        if (!uuidv7Schema.safeParse(selectedTeamId).success)
          return errorResponse(
            c,
            400,
            'VALIDATION_ERROR',
            '選択中チームIDが不正です。',
          );
        const selected =
          await options.centralFeatures.authTeamSelection.repository.findActiveMembership(
            claims.userId,
            selectedTeamId,
          );
        membership = selected
          ? { tenantId: selected.tenantId, role: selected.role }
          : null;
      } else {
        membership = await options.membershipRepository.findActiveByUserId(
          claims.userId,
        );
      }
    } catch {
      return errorResponse(
        c,
        503,
        'DEPENDENCY_UNAVAILABLE',
        '所属情報を確認できません。',
      );
    }
    if (!membership)
      return errorResponse(c, 403, 'FORBIDDEN', '利用可能な所属がありません。');
    c.set('auth', { userId: claims.userId, membership });
    await next();
  };

  // 招待受諾はまだtenant membershipがない利用者も通すため、JWTだけを検証する。
  const authenticateUser: MiddlewareHandler<ApiEnv> = async (c, next) => {
    const token = extractBearerToken(c.req.header('authorization') ?? null);
    if (!options.verifyToken)
      return errorResponse(
        c,
        503,
        'AUTH_NOT_CONFIGURED',
        '認証が設定されていません。',
      );
    if (!token)
      return errorResponse(c, 401, 'UNAUTHENTICATED', '認証が必要です。');
    try {
      const claims = await options.verifyToken(token);
      c.set('authUserId', claims.userId);
      c.set('authProviders', claims.authProviders ?? []);
      c.set('authProviderSubjects', claims.authProviderSubjects ?? {});
    } catch {
      return errorResponse(
        c,
        401,
        'UNAUTHENTICATED',
        '認証情報を確認できません。',
      );
    }
    await next();
  };

  // system adminはtenant membershipを持たない運用も許可するが、署名済みapp_metadataのclaimだけで判定する。
  const authenticateSystemAdmin: MiddlewareHandler<ApiEnv> = async (
    c,
    next,
  ) => {
    const token = extractBearerToken(c.req.header('authorization') ?? null);
    if (!options.verifyToken)
      return errorResponse(
        c,
        503,
        'AUTH_NOT_CONFIGURED',
        '認証が設定されていません。',
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
      if (!claims.systemAdmin)
        return errorResponse(
          c,
          403,
          'FORBIDDEN',
          'システム管理者の権限がありません。',
        );
      c.set('systemAuth', { userId: claims.userId });
    } catch {
      return errorResponse(
        c,
        401,
        'UNAUTHENTICATED',
        '認証情報を確認できません。',
      );
    }
    await next();
  };

  app.use('/api/v1/members/*', authenticate);
  app.use('/api/v1/notifications/line', authenticate);
  app.use('/api/v1/notifications/line/:notificationId/retry', authenticate);
  app.use('/api/v1/auth/context', authenticate);
  app.use('/api/v1/system/context', authenticateSystemAdmin);
  app.use('/api/v1/system/announcements', authenticateSystemAdmin);
  app.use('/api/v1/system/announcements/*', authenticateSystemAdmin);
  app.use('/api/v1/system/features', authenticateSystemAdmin);
  app.use('/api/v1/system/features/*', authenticateSystemAdmin);
  if (options.centralFeatures?.authInvitations) {
    app.use('/api/v1/auth/invitations', authenticate);
    app.use('/api/v1/auth/invitations/:invitationId/revoke', authenticate);
    app.use('/api/v1/auth/invitations/accept', authenticateUser);
  }
  if (options.eventRepository) {
    app.use('/api/v1/events', authenticate);
    app.use('/api/v1/events/*', authenticate);
  }
  if (options.centralFeatures?.boardContact) {
    app.use('/api/v1/board-members', authenticate);
    app.use('/api/v1/board-members/*', authenticate);
  }
  if (options.centralFeatures?.attachments) {
    app.use('/api/v1/uploads', authenticate);
    app.use('/api/v1/uploads/*', authenticate);
  }
  if (options.centralFeatures?.bulletinBoard) {
    app.use('/api/v1/announcements', authenticate);
    app.use('/api/v1/announcements/*', authenticate);
  }
  if (options.centralFeatures?.featureContract) {
    app.use('/api/v1/feature-contract', authenticate);
    app.use('/api/v1/feature-contract/*', authenticate);
  }
  if (options.centralFeatures?.line) {
    app.use('/api/v1/line', authenticate);
    app.use('/api/v1/line/*', authenticate);
  }
  if (options.centralFeatures?.ride) {
    app.use('/api/v1/ride-profile', authenticate);
    app.use('/api/v1/ride-profile/*', authenticate);
    app.use('/api/v1/ride-plans', authenticate);
    app.use('/api/v1/ride-plans/*', authenticate);
  }
  if (options.centralFeatures?.orders) {
    app.use('/api/v1/orders', authenticate);
    app.use('/api/v1/orders/*', authenticate);
  }

  const featureContractRepository =
    options.centralFeatures?.featureContract?.repository;
  const featureContractUnavailable: MiddlewareHandler<ApiEnv> = async (c) =>
    errorResponse(
      c,
      503,
      'FEATURE_CONTRACT_NOT_CONFIGURED',
      '機能契約を確認できないため、この機能を利用できません。',
    );
  const useFeature = (path: string, featureKey: string) => {
    app.use(
      path,
      featureContractRepository
        ? createFeatureEntitlementMiddleware(
            featureContractRepository,
            featureKey,
          )
        : featureContractUnavailable,
    );
  };
  if (options.memberRepository || options.promotionRepository) {
    useFeature('/api/v1/members', 'members');
    useFeature('/api/v1/members/*', 'members');
  }
  if (options.centralFeatures?.boardContact) {
    useFeature('/api/v1/board-members', 'board-contacts');
    useFeature('/api/v1/board-members/*', 'board-contacts');
  }
  if (options.eventRepository) {
    useFeature('/api/v1/events', 'events-attendance');
    useFeature('/api/v1/events/*', 'events-attendance');
  }
  if (options.centralFeatures?.attachments) {
    useFeature('/api/v1/uploads', 'attachments');
    useFeature('/api/v1/uploads/*', 'attachments');
  }
  if (options.centralFeatures?.bulletinBoard) {
    useFeature('/api/v1/announcements', 'bulletin-board');
    useFeature('/api/v1/announcements/*', 'bulletin-board');
  }
  if (options.centralFeatures?.line) {
    useFeature('/api/v1/line/status', 'line-notifications');
    useFeature('/api/v1/line/status/*', 'line-notifications');
    useFeature('/api/v1/line/connect', 'line-notifications');
    useFeature('/api/v1/line/connect/*', 'line-notifications');
    useFeature('/api/v1/line/notifications', 'line-notifications');
    useFeature('/api/v1/line/notifications/*', 'line-notifications');
  }
  if (options.lineDeliveryProducer) {
    useFeature('/api/v1/notifications/line', 'line-notifications');
    useFeature('/api/v1/notifications/line/*', 'line-notifications');
  }
  if (options.centralFeatures?.ride) {
    useFeature('/api/v1/ride-profile', 'ride-operations');
    useFeature('/api/v1/ride-profile/*', 'ride-operations');
    useFeature('/api/v1/ride-plans', 'ride-operations');
    useFeature('/api/v1/ride-plans/*', 'ride-operations');
  }
  if (options.centralFeatures?.orders) {
    useFeature('/api/v1/orders', 'orders-payments');
    useFeature('/api/v1/orders/*', 'orders-payments');
  }

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
  const invitationAcceptRateLimit = createRateLimitMiddleware({
    scope: 'authenticated',
    ...rateLimitPolicies.authenticated,
    store: rateLimitStore,
    now: rateLimitOptions.now,
    namespace: rateLimitNamespace,
    timeoutMs: rateLimitOptions.timeoutMs,
    keyResolver: (c) => ({
      kind: 'user',
      tenantId: 'invitation-accept',
      userId: c.get('authUserId'),
    }),
  });
  const authenticatedRateLimitForRoutes: MiddlewareHandler<ApiEnv> = async (
    c,
    next,
  ) => {
    if (isPublicLineWebhook(c)) return next();
    return authenticatedRateLimit(c, next);
  };
  app.use('/api/v1/members/*', authenticatedRateLimit);
  app.use('/api/v1/notifications/line', authenticatedRateLimit);
  app.use(
    '/api/v1/notifications/line/:notificationId/retry',
    authenticatedRateLimit,
  );
  app.use('/api/v1/auth/context', authenticatedRateLimit);
  app.use(
    '/api/v1/system/context',
    createRateLimitMiddleware({
      scope: 'authenticated',
      ...rateLimitPolicies.authenticated,
      store: rateLimitStore,
      now: rateLimitOptions.now,
      namespace: rateLimitNamespace,
      timeoutMs: rateLimitOptions.timeoutMs,
      keyResolver: (c) => ({
        kind: 'user',
        tenantId: 'system-admin',
        userId: c.get('systemAuth').userId,
      }),
    }),
  );
  const systemAdminRateLimit = createRateLimitMiddleware({
    scope: 'authenticated',
    ...rateLimitPolicies.authenticated,
    store: rateLimitStore,
    now: rateLimitOptions.now,
    namespace: rateLimitNamespace,
    timeoutMs: rateLimitOptions.timeoutMs,
    keyResolver: (c) => ({
      kind: 'user',
      tenantId: 'system-admin',
      userId: c.get('systemAuth').userId,
    }),
  });
  app.use('/api/v1/system/announcements', systemAdminRateLimit);
  app.use('/api/v1/system/announcements/*', systemAdminRateLimit);
  app.use('/api/v1/system/features', systemAdminRateLimit);
  app.use('/api/v1/system/features/*', systemAdminRateLimit);
  if (options.centralFeatures?.authInvitations) {
    app.use('/api/v1/auth/invitations', authenticatedRateLimit);
    app.use(
      '/api/v1/auth/invitations/:invitationId/revoke',
      authenticatedRateLimit,
    );
    app.use('/api/v1/auth/invitations/accept', invitationAcceptRateLimit);
  }
  if (options.eventRepository) {
    app.use('/api/v1/events', authenticatedRateLimit);
    app.use('/api/v1/events/*', authenticatedRateLimit);
    app.route(
      '/api/v1/events',
      createEventsApp({
        eventRepository: options.eventRepository,
        useCentralAuth: true,
      }),
    );
  }
  if (options.centralFeatures?.boardContact) {
    app.use('/api/v1/board-members', authenticatedRateLimit);
    app.use('/api/v1/board-members/*', authenticatedRateLimit);
  }
  if (options.centralFeatures?.attachments) {
    app.use('/api/v1/uploads', authenticatedRateLimit);
    app.use('/api/v1/uploads/*', authenticatedRateLimit);
  }
  if (options.centralFeatures?.bulletinBoard) {
    app.use('/api/v1/announcements', authenticatedRateLimit);
    app.use('/api/v1/announcements/*', authenticatedRateLimit);
  }
  if (options.centralFeatures?.featureContract) {
    app.use('/api/v1/feature-contract', authenticatedRateLimit);
    app.use('/api/v1/feature-contract/*', authenticatedRateLimit);
  }
  if (options.centralFeatures?.line) {
    if (options.centralFeatures.line.webhook) {
      app.use(
        '/api/v1/line/webhook',
        createRateLimitMiddleware({
          scope: 'line-webhook',
          ...rateLimitPolicies.lineWebhook,
          store: rateLimitStore,
          now: rateLimitOptions.now,
          namespace: rateLimitNamespace,
          timeoutMs: rateLimitOptions.timeoutMs,
          keyResolver: () => ({
            kind: 'client',
            clientId: 'line-webhook',
            ipAddress: 'global',
          }),
        }),
      );
    }
    app.use('/api/v1/line', authenticatedRateLimitForRoutes);
    app.use('/api/v1/line/*', authenticatedRateLimitForRoutes);
  }
  if (options.centralFeatures?.ride) {
    app.use('/api/v1/ride-profile', authenticatedRateLimit);
    app.use('/api/v1/ride-profile/*', authenticatedRateLimit);
    app.use('/api/v1/ride-plans', authenticatedRateLimit);
    app.use('/api/v1/ride-plans/*', authenticatedRateLimit);
  }
  if (options.centralFeatures?.orders) {
    app.use('/api/v1/orders', authenticatedRateLimit);
    app.use('/api/v1/orders/*', authenticatedRateLimit);
  }

  app.get('/api/v1/auth/context', (c) => {
    const auth = c.get('auth');
    return c.json({
      data: {
        tenantId: auth.membership.tenantId,
        role: auth.membership.role,
      },
    });
  });

  app.get('/api/v1/system/context', (c) => {
    c.get('systemAuth');
    return c.json({ data: { systemAdmin: true } });
  });

  app.route(
    '/',
    createSystemAdminApp({ repository: options.systemAdminRepository }),
  );

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
      const deliveryError = error as { status?: unknown; code?: unknown };
      if (error instanceof Error && deliveryError.status === 409)
        return errorResponse(
          c,
          409,
          typeof deliveryError.code === 'string'
            ? deliveryError.code
            : 'LINE_DELIVERY_CONFLICT',
          deliveryError.code === 'LINE_NOT_CONNECTED'
            ? 'LINEが未接続か、通知先が現在の接続先と一致しません。'
            : '同じtenant内で通知の冪等キーまたはpayloadが競合しました。',
        );
      throw error;
    }
  });

  // 失敗済み通知の再試行も現行outboxの接続世代とowner/admin境界を通す。
  app.post('/api/v1/notifications/line/:notificationId/retry', async (c) => {
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
        'LINE通知を再試行する権限がありません。',
      );
    const notificationId = c.req.param('notificationId');
    if (!uuidv7Schema.safeParse(notificationId).success)
      return errorResponse(c, 400, 'VALIDATION_ERROR', '通知IDが不正です。');
    try {
      const result = await options.lineDeliveryProducer.retry({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
        notificationId,
      });
      return c.json(
        { data: { notificationId: result.notificationId, status: 'pending' } },
        202,
      );
    } catch (error) {
      const deliveryError = error as { status?: unknown; code?: unknown };
      if (error instanceof Error && deliveryError.status === 409)
        return errorResponse(
          c,
          409,
          typeof deliveryError.code === 'string'
            ? deliveryError.code
            : 'LINE_DELIVERY_RETRY_CONFLICT',
          deliveryError.code === 'LINE_NOT_CONNECTED'
            ? 'LINEが未接続か、通知の接続世代が古くなっています。'
            : '失敗状態で再試行可能なLINE通知がありません。',
        );
      throw error;
    }
  });

  mountCentralFeatureRoutes({
    verifyToken: options.verifyToken,
    membershipRepository: options.membershipRepository,
    features: options.centralFeatures,
    rideApp: app,
    getRideAuth: (context) => {
      const auth = context.get('auth') as
        | ApiEnv['Variables']['auth']
        | undefined;
      return auth
        ? {
            tenantId: auth.membership.tenantId,
            userId: auth.userId,
            role: auth.membership.role,
          }
        : null;
    },
  });

  return app;
}
