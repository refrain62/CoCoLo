import {
  featureFlagUpdateSchema,
  featureKeySchema,
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
};

function errorResponse(
  c: Context<ApiEnv>,
  status: 400 | 401 | 403 | 404 | 500 | 503,
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
      return errorResponse(c, 400, 'VALIDATION_ERROR', 'JSON入力が不正です。');
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
