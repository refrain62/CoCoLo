import {
  rideAssignmentSchema,
  rideMatchSchema,
  rideOfferCreateSchema,
  ridePlanCreateSchema,
  ridePlanIdSchema,
  ridePlanTransitionSchema,
  rideRequestCreateSchema,
} from '@cocolo/contracts/ride';
import { getSubjectMemberId } from '@cocolo/contracts/subject-member';
import type { Context, Hono } from 'hono';
import { contextRequestId } from '../../security/request-id.js';
import type { RideService } from './ride-service.js';

export type RideRouteApp = Pick<Hono, 'get' | 'post'>;
export type RideAuthContext = import('./ride-service.js').RideActor;
export type RideRouteDependencies = {
  service: RideService;
  getAuth: (context: Context) => RideAuthContext | null;
};

function errorResponse(
  context: Context,
  status: 400 | 401 | 403 | 404 | 409 | 500,
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
        requestId: contextRequestId(context),
      },
    },
    status,
  );
}

function parseAuth(context: Context, dependencies: RideRouteDependencies) {
  return dependencies.getAuth(context);
}

async function parseJson(context: Context) {
  try {
    return await context.req.json();
  } catch {
    return null;
  }
}

function handleError(context: Context, error: unknown) {
  if (error instanceof Error && 'code' in error) {
    const code = error.code;
    if (
      code === 'RIDE_STATE_CONFLICT' ||
      code === 'RIDE_FINALIZE_BLOCKED' ||
      code === 'RIDE_CAPACITY_EXCEEDED'
    )
      return errorResponse(context, 409, code, error.message);
  }
  if (error instanceof Error && 'status' in error) {
    const status = error.status;
    if (status === 403)
      return errorResponse(context, 403, 'FORBIDDEN', error.message);
    if (status === 404)
      return errorResponse(context, 404, 'NOT_FOUND', error.message);
    if (status === 409)
      return errorResponse(context, 409, 'RIDE_CONFLICT', error.message);
  }
  if (error instanceof Error && 'code' in error) {
    const code = error.code;
    if (code === 'RIDE_VALIDATION_ERROR')
      return errorResponse(context, 400, code, error.message);
    if (code === 'RIDE_CAPACITY_EXCEEDED')
      return errorResponse(context, 409, code, error.message);
  }
  return errorResponse(
    context,
    500,
    'INTERNAL_SERVER_ERROR',
    '予期しないエラーが発生しました。',
  );
}

function parsePlanId(context: Context) {
  const parsed = ridePlanIdSchema.safeParse(context.req.param('planId'));
  return parsed.success ? parsed.data : null;
}

// 認証済みコンテキストを必須にして、tenantIdやuserIdをHTTP入力から受け取らずに送迎APIを登録する。
export function registerRideRoutes(
  app: RideRouteApp,
  dependencies: RideRouteDependencies,
) {
  app.get('/api/v1/ride-plans', async (context) => {
    const auth = parseAuth(context, dependencies);
    if (!auth)
      return errorResponse(context, 401, 'UNAUTHENTICATED', '認証が必要です。');
    try {
      return context.json({ data: await dependencies.service.listPlans(auth) });
    } catch (error) {
      return handleError(context, error);
    }
  });

  app.post('/api/v1/ride-plans', async (context) => {
    const auth = parseAuth(context, dependencies);
    if (!auth)
      return errorResponse(context, 401, 'UNAUTHENTICATED', '認証が必要です。');
    const parsed = ridePlanCreateSchema.safeParse(await parseJson(context));
    if (!parsed.success)
      return errorResponse(
        context,
        400,
        'VALIDATION_ERROR',
        '送迎予定の入力が不正です。',
        parsed.error.flatten(),
      );
    try {
      const plan = await dependencies.service.createPlan(auth, parsed.data);
      return context.json({ data: plan }, 201);
    } catch (error) {
      return handleError(context, error);
    }
  });

  app.get('/api/v1/ride-plans/:planId', async (context) => {
    const auth = parseAuth(context, dependencies);
    if (!auth)
      return errorResponse(context, 401, 'UNAUTHENTICATED', '認証が必要です。');
    const planId = parsePlanId(context);
    if (!planId)
      return errorResponse(
        context,
        400,
        'VALIDATION_ERROR',
        '対象IDが不正です。',
      );
    try {
      return context.json({
        data: await dependencies.service.getSnapshot(auth, planId),
      });
    } catch (error) {
      return handleError(context, error);
    }
  });

  app.post('/api/v1/ride-plans/:planId/status', async (context) => {
    const auth = parseAuth(context, dependencies);
    if (!auth)
      return errorResponse(context, 401, 'UNAUTHENTICATED', '認証が必要です。');
    const planId = parsePlanId(context);
    const parsed = ridePlanTransitionSchema.safeParse(await parseJson(context));
    if (!planId || !parsed.success)
      return errorResponse(
        context,
        400,
        'VALIDATION_ERROR',
        '送迎予定の状態変更内容が不正です。',
        parsed.success ? {} : parsed.error.flatten(),
      );
    try {
      return context.json({
        data: await dependencies.service.transitionPlan(
          auth,
          planId,
          parsed.data,
        ),
      });
    } catch (error) {
      return handleError(context, error);
    }
  });

  app.post('/api/v1/ride-plans/:planId/offers', async (context) => {
    const auth = parseAuth(context, dependencies);
    if (!auth)
      return errorResponse(context, 401, 'UNAUTHENTICATED', '認証が必要です。');
    const planId = parsePlanId(context);
    const parsed = rideOfferCreateSchema.safeParse(await parseJson(context));
    if (!planId || !parsed.success)
      return errorResponse(
        context,
        400,
        'VALIDATION_ERROR',
        '車の登録内容が不正です。',
      );
    try {
      return context.json(
        {
          data: await dependencies.service.createOffer(
            auth,
            planId,
            parsed.data,
          ),
        },
        201,
      );
    } catch (error) {
      return handleError(context, error);
    }
  });

  app.post('/api/v1/ride-plans/:planId/requests', async (context) => {
    const auth = parseAuth(context, dependencies);
    if (!auth)
      return errorResponse(context, 401, 'UNAUTHENTICATED', '認証が必要です。');
    const planId = parsePlanId(context);
    const parsed = rideRequestCreateSchema.safeParse(await parseJson(context));
    if (!planId || !parsed.success)
      return errorResponse(
        context,
        400,
        'VALIDATION_ERROR',
        '乗車希望の登録内容が不正です。',
      );
    const subjectMemberId = getSubjectMemberId(parsed.data);
    if (!subjectMemberId)
      return errorResponse(
        context,
        400,
        'VALIDATION_ERROR',
        '対象memberが指定されていません。',
      );
    try {
      return context.json(
        {
          data: await dependencies.service.createRequest(auth, planId, {
            ...parsed.data,
            memberId: subjectMemberId,
          }),
        },
        201,
      );
    } catch (error) {
      return handleError(context, error);
    }
  });

  app.post('/api/v1/ride-plans/:planId/match', async (context) => {
    const auth = parseAuth(context, dependencies);
    if (!auth)
      return errorResponse(context, 401, 'UNAUTHENTICATED', '認証が必要です。');
    const planId = parsePlanId(context);
    const parsed = rideMatchSchema.safeParse(await parseJson(context));
    if (!planId || !parsed.success)
      return errorResponse(
        context,
        400,
        'VALIDATION_ERROR',
        'マッチング要求の形式が不正です。',
      );
    try {
      return context.json({
        data: await dependencies.service.autoMatch(auth, planId),
      });
    } catch (error) {
      return handleError(context, error);
    }
  });

  app.post('/api/v1/ride-plans/:planId/assignments', async (context) => {
    const auth = parseAuth(context, dependencies);
    if (!auth)
      return errorResponse(context, 401, 'UNAUTHENTICATED', '認証が必要です。');
    const planId = parsePlanId(context);
    const parsed = rideAssignmentSchema.safeParse(await parseJson(context));
    if (!planId || !parsed.success)
      return errorResponse(
        context,
        400,
        'VALIDATION_ERROR',
        '手動割当の入力が不正です。',
      );
    try {
      return context.json(
        { data: await dependencies.service.assign(auth, planId, parsed.data) },
        201,
      );
    } catch (error) {
      return handleError(context, error);
    }
  });

  app.get('/api/v1/ride-plans/:planId/dispatch', async (context) => {
    const auth = parseAuth(context, dependencies);
    if (!auth)
      return errorResponse(context, 401, 'UNAUTHENTICATED', '認証が必要です。');
    const planId = parsePlanId(context);
    if (!planId)
      return errorResponse(
        context,
        400,
        'VALIDATION_ERROR',
        '対象IDが不正です。',
      );
    try {
      return context.json({
        data: await dependencies.service.getDispatch(auth, planId),
      });
    } catch (error) {
      return handleError(context, error);
    }
  });

  app.get('/api/v1/ride-plans/:planId/metrics', async (context) => {
    const auth = parseAuth(context, dependencies);
    if (!auth)
      return errorResponse(context, 401, 'UNAUTHENTICATED', '認証が必要です。');
    const planId = parsePlanId(context);
    if (!planId)
      return errorResponse(
        context,
        400,
        'VALIDATION_ERROR',
        '対象IDが不正です。',
      );
    try {
      return context.json({
        data: await dependencies.service.getMetrics(auth, planId),
      });
    } catch (error) {
      return handleError(context, error);
    }
  });
}
