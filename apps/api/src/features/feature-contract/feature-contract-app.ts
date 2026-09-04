import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  featureFlagUpdateSchema,
  featureKeySchema,
  featurePlanSyncSchema,
  paidFeatureGrantSchema,
} from '@cocolo/contracts/feature-contract';
import {
  FeatureContractError,
  type FeatureContractRepository,
} from '@cocolo/db/feature-contract';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import type { ApiEnv } from '../../app.js';

type FeatureContractAuth = ApiEnv['Variables']['auth'];

export type FeatureContractAppOptions = {
  repository?: FeatureContractRepository;
  useCentralAuth?: boolean;
  operatorAuth?: FeatureContractOperatorAuth;
  includePublicRoutes?: boolean;
  includeOperatorRoutes?: boolean;
};

export type FeatureContractOperatorAuth = {
  resolveActorUserId: (token: string | null) => string | null;
  resolveGrantActorUserId: (
    token: string | null,
    tenantId: string,
  ) => string | null;
  verifyProviderSignature: (body: string, signature: string | null) => boolean;
};

const SYSTEM_FEATURE_OPERATOR_ID = 'system:feature-contract';
const SYSTEM_FEATURE_GRANT_ID = 'system:feature-grant';

// grant secretそのものは送らず、対象tenantごとのHMAC tokenだけを内部gatewayへ渡す。
export function createTenantGrantToken(input: {
  grantToken: string;
  tenantId: string;
}) {
  return `${input.tenantId}.${createHmac('sha256', input.grantToken)
    .update(input.tenantId)
    .digest('hex')}`;
}

// 課金連携は固定system principalとして監査し、provider署名とsecretを通常JWTから分離する。
export function createStaticFeatureContractOperatorAuth(input: {
  token: string;
  grantToken: string;
  providerWebhookSecret: string;
}): FeatureContractOperatorAuth {
  const expected = Buffer.from(input.token, 'utf8');
  const webhookSecret = Buffer.from(input.providerWebhookSecret, 'utf8');
  return {
    resolveActorUserId(token) {
      if (!token) return null;
      const actual = Buffer.from(token, 'utf8');
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        return null;
      return SYSTEM_FEATURE_OPERATOR_ID;
    },
    resolveGrantActorUserId(token, tenantId) {
      if (!token) return null;
      const separatorIndex = token.indexOf('.');
      if (separatorIndex <= 0 || token.slice(0, separatorIndex) !== tenantId)
        return null;
      const actual = Buffer.from(token.slice(separatorIndex + 1), 'utf8');
      const expectedGrant = Buffer.from(
        createHmac('sha256', input.grantToken).update(tenantId).digest('hex'),
        'utf8',
      );
      if (
        actual.length !== expectedGrant.length ||
        !timingSafeEqual(actual, expectedGrant)
      )
        return null;
      return SYSTEM_FEATURE_GRANT_ID;
    },
    verifyProviderSignature(body, signature) {
      if (!signature) return false;
      const expectedSignature = Buffer.from(
        createHmac('sha256', webhookSecret).update(body).digest('hex'),
        'utf8',
      );
      const actualSignature = Buffer.from(signature, 'utf8');
      return (
        actualSignature.length === expectedSignature.length &&
        timingSafeEqual(actualSignature, expectedSignature)
      );
    },
  };
}

function errorResponse(
  c: Context<ApiEnv>,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 503,
  code: string,
  message: string,
  details: unknown = {},
) {
  return c.json(
    { error: { code, message, details, requestId: c.get('requestId') } },
    status,
  );
}

function getAuth(c: Context<ApiEnv>): FeatureContractAuth {
  const auth = c.get('auth');
  if (!auth?.userId || !auth.membership?.tenantId)
    throw new Error('認証コンテキストが設定されていません。');
  return auth;
}

function projectSnapshot(
  snapshot: Awaited<ReturnType<FeatureContractRepository['get']>>,
) {
  return {
    planKey: snapshot.planKey,
    planStatus: snapshot.planStatus,
    features: snapshot.features.map((feature) => ({
      key: feature.key,
      billingType: feature.billingType,
      displayName: feature.displayName,
      enabled: feature.enabled,
      reason: feature.reason,
    })),
  };
}

// 有効機能の判定をAPIから返す。Webのメニュー制御はこの結果を使うが、認可は各APIで再確認する。
export function createFeatureContractApp(
  options: FeatureContractAppOptions = {},
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.onError((error, c) => {
    if (error instanceof FeatureContractError)
      return errorResponse(c, error.status, error.code, error.message);
    return errorResponse(
      c,
      500,
      'INTERNAL_SERVER_ERROR',
      '予期しないエラーが発生しました。',
    );
  });

  if (options.includePublicRoutes !== false) {
    app.get('/api/v1/feature-contract', async (c) => {
      if (!options.repository)
        return errorResponse(
          c,
          503,
          'DEPENDENCY_UNAVAILABLE',
          '機能契約データストアが設定されていません。',
        );
      const auth = getAuth(c);
      const snapshot = await options.repository.get({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
      });
      return c.json({ data: projectSnapshot(snapshot) });
    });

    app.patch('/api/v1/feature-contract/:featureKey', async (c) => {
      if (!options.repository)
        return errorResponse(
          c,
          503,
          'DEPENDENCY_UNAVAILABLE',
          '機能契約データストアが設定されていません。',
        );
      const auth = getAuth(c);
      if (auth.membership.role !== 'owner' && auth.membership.role !== 'admin')
        return errorResponse(
          c,
          403,
          'FORBIDDEN',
          '機能flagを変更する権限がありません。',
        );
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
        return errorResponse(
          c,
          400,
          'VALIDATION_ERROR',
          'JSON入力が不正です。',
        );
      }
      const parsed = featureFlagUpdateSchema.safeParse(body);
      if (!parsed.success)
        return errorResponse(
          c,
          400,
          'VALIDATION_ERROR',
          '入力値が不正です。',
          parsed.error.flatten(),
        );
      const snapshot = await options.repository.setFreeFlag({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
        featureKey: parsedKey.data,
        enabled: parsed.data.enabled,
        reason: parsed.data.reason,
      });
      return c.json({ data: projectSnapshot(snapshot) });
    });
  }

  if (options.includeOperatorRoutes) {
    let operatorWindowStartedAt = Date.now();
    let operatorRequests = 0;
    app.use('*', async (c, next) => {
      const now = Date.now();
      if (now - operatorWindowStartedAt >= 60_000) {
        operatorWindowStartedAt = now;
        operatorRequests = 0;
      }
      if (operatorRequests >= 60)
        return errorResponse(
          c,
          429,
          'RATE_LIMITED',
          '課金連携の要求が多すぎます。',
        );
      operatorRequests += 1;
      const contentLength = Number(c.req.header('content-length') ?? '0');
      if (contentLength > 64 * 1024)
        return errorResponse(
          c,
          413,
          'PAYLOAD_TOO_LARGE',
          '課金連携の入力が大きすぎます。',
        );
      return next();
    });
    app.post('/internal/feature-contract/plan-sync', async (c) => {
      if (!options.repository)
        return errorResponse(
          c,
          503,
          'DEPENDENCY_UNAVAILABLE',
          '機能契約データストアが設定されていません。',
        );
      if (!options.operatorAuth)
        return errorResponse(
          c,
          503,
          'DEPENDENCY_UNAVAILABLE',
          '課金連携の運用者認証が設定されていません。',
        );
      const actorUserId = options.operatorAuth.resolveActorUserId(
        c.req.header('x-cocolo-operator-token') ?? null,
      );
      if (!actorUserId)
        return errorResponse(
          c,
          401,
          'UNAUTHENTICATED',
          '課金連携の認証情報を確認できません。',
        );
      const rawBody = await c.req.text();
      if (
        !options.operatorAuth.verifyProviderSignature(
          rawBody,
          c.req.header('x-cocolo-provider-signature') ?? null,
        )
      )
        return errorResponse(
          c,
          401,
          'UNAUTHENTICATED',
          '課金providerの署名を確認できません。',
        );
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return errorResponse(
          c,
          400,
          'VALIDATION_ERROR',
          'JSON入力が不正です。',
        );
      }
      const parsed = featurePlanSyncSchema.safeParse(body);
      if (!parsed.success)
        return errorResponse(
          c,
          400,
          'VALIDATION_ERROR',
          '課金連携のプラン入力が不正です。',
          parsed.error.flatten(),
        );
      try {
        await options.repository.syncPlan({
          ...parsed.data,
          actorUserId,
          startsAt: new Date(parsed.data.startsAt),
          endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null,
        });
      } catch (error) {
        if (error instanceof FeatureContractError)
          return errorResponse(c, error.status, error.code, error.message);
        throw error;
      }
      return c.body(null, 204);
    });

    app.post('/internal/feature-contract/paid-grant', async (c) => {
      if (!options.repository)
        return errorResponse(
          c,
          503,
          'DEPENDENCY_UNAVAILABLE',
          '機能契約データストアが設定されていません。',
        );
      if (!options.operatorAuth)
        return errorResponse(
          c,
          503,
          'DEPENDENCY_UNAVAILABLE',
          '課金連携の運用者認証が設定されていません。',
        );
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return errorResponse(
          c,
          400,
          'VALIDATION_ERROR',
          'JSON入力が不正です。',
        );
      }
      const parsed = paidFeatureGrantSchema.safeParse(body);
      if (!parsed.success)
        return errorResponse(
          c,
          400,
          'VALIDATION_ERROR',
          '有償feature付与入力が不正です。',
          parsed.error.flatten(),
        );
      const actorUserId = options.operatorAuth.resolveGrantActorUserId(
        c.req.header('x-cocolo-grant-token') ?? null,
        parsed.data.tenantId,
      );
      if (!actorUserId)
        return errorResponse(
          c,
          401,
          'UNAUTHENTICATED',
          '課金連携の認証情報を確認できません。',
        );
      const approvalToken = c.req.header('x-cocolo-approval-token');
      if (!approvalToken)
        return errorResponse(
          c,
          401,
          'UNAUTHENTICATED',
          '承認台帳の認証情報を確認できません。',
        );
      try {
        await options.repository.grantPaidFeature({
          ...parsed.data,
          actorUserId,
          approvalToken,
          startsAt: new Date(parsed.data.startsAt),
          endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null,
        });
      } catch (error) {
        if (error instanceof FeatureContractError)
          return errorResponse(c, error.status, error.code, error.message);
        throw error;
      }
      return c.body(null, 204);
    });
  }

  return app;
}

// 業務APIの入口でもeffective entitlementを再確認し、画面の非表示だけで利用制限を成立させない。
export function createFeatureEntitlementMiddleware(
  repository: FeatureContractRepository,
  featureKey: string,
): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    if (!auth?.userId || !auth.membership?.tenantId)
      return errorResponse(c, 401, 'UNAUTHENTICATED', '認証が必要です。');
    try {
      const snapshot = await repository.get({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
      });
      const feature = snapshot.features.find((item) => item.key === featureKey);
      if (!feature?.enabled)
        return errorResponse(
          c,
          403,
          'FEATURE_UNAVAILABLE',
          'この機能はチームの契約で利用できません。',
        );
    } catch (error) {
      if (error instanceof FeatureContractError)
        return errorResponse(c, error.status, error.code, error.message);
      return errorResponse(
        c,
        503,
        'DEPENDENCY_UNAVAILABLE',
        '機能契約を確認できません。',
      );
    }
    return next();
  };
}
