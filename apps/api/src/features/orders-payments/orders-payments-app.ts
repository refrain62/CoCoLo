import { extractBearerToken, type TokenVerifier } from '@cocolo/auth';
import {
  orderCreateSchema,
  orderEntryCreateSchema,
  orderListQuerySchema,
  orderProductSchema,
  orderStatusUpdateSchema,
  parseUuidv7ResourceId,
  paymentStatusQuerySchema,
  paymentUpdateSchema,
} from '@cocolo/contracts/orders';
import { getSubjectMemberId } from '@cocolo/contracts/subject-member';
import {
  type OrdersRepository,
  OrdersRepositoryError,
} from '@cocolo/db/orders';
import { isOrdersManager, type OrdersRole } from '@cocolo/domain/orders';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ApiEnv } from '../../app.js';

type Membership = ApiEnv['Variables']['auth']['membership'];
type OrdersAuth = ApiEnv['Variables']['auth'];

export type OrdersPaymentsApiEnv = {
  Variables: {
    requestId: string;
    // 中央appが解決したselected tenantをそのまま受け取り、注文appで再解決しない。
    auth: OrdersAuth;
  };
};

export type OrdersPaymentsAppOptions = {
  verifyToken?: TokenVerifier;
  membershipRepository?: {
    findActiveByUserId: (userId: string) => Promise<Membership | null>;
  };
  ordersRepository: OrdersRepository;
  useCentralAuth?: boolean;
};

class AuthContextError extends Error {
  constructor() {
    super('認証コンテキストが設定されていません。');
    this.name = 'AuthContextError';
  }
}

const ordersRoles = new Set<OrdersRole>([
  'owner',
  'admin',
  'staff',
  'guardian',
]);

// 中央appと単独appのどちらでも、repositoryへ渡す前にtenant・roleの形を検証する。
function getOrdersAuth(c: Context<OrdersPaymentsApiEnv>): OrdersAuth {
  const auth = c.get('auth') as OrdersAuth | undefined;
  if (
    !auth ||
    typeof auth.userId !== 'string' ||
    typeof auth.membership?.tenantId !== 'string' ||
    !ordersRoles.has(auth.membership.role)
  )
    throw new AuthContextError();
  return auth;
}

function errorResponse(
  c: Context<OrdersPaymentsApiEnv>,
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

function idempotencyKey(c: Context<OrdersPaymentsApiEnv>) {
  const key = c.req.header('idempotency-key')?.trim() || null;
  if (key && key.length > 128)
    throw new InputError('Idempotency-Key は128文字以内で指定してください。');
  return key;
}

function resourceId(c: Context<OrdersPaymentsApiEnv>, name: string) {
  try {
    return parseUuidv7ResourceId(c.req.param(name));
  } catch {
    throw new InputError(`${name}はUUIDv7形式で指定してください。`);
  }
}

class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

async function readJson(c: Context<OrdersPaymentsApiEnv>) {
  try {
    return await c.req.json();
  } catch {
    throw new InputError('JSON入力が不正です。');
  }
}

function projectCampaign(
  campaign: Awaited<ReturnType<OrdersRepository['getCampaign']>>,
) {
  return {
    id: campaign.id,
    title: campaign.title,
    deadline: campaign.deadline,
    status: campaign.status,
    products: campaign.products.map((product) => ({
      id: product.id,
      name: product.name,
      unitPrice: product.unitPrice,
      imageUrl: product.imageUrl,
      options: product.options,
      requiresBackNumber: product.requiresBackNumber,
      requiresBackName: product.requiresBackName,
    })),
    createdAt: campaign.createdAt,
  };
}

function projectEntry(
  entry: Awaited<ReturnType<OrdersRepository['createEntry']>>,
  role: OrdersRole,
) {
  return {
    id: entry.id,
    campaignId: entry.campaignId,
    ordererName: entry.ordererName,
    memberId: entry.memberId,
    memberName: entry.memberName,
    lines: entry.lines,
    totalAmount: entry.totalAmount,
    paymentStatus: entry.paymentStatus,
    paymentConfirmedAt: entry.paymentConfirmedAt,
    ...(isOrdersManager(role)
      ? { paymentConfirmedBy: entry.paymentConfirmedBy }
      : {}),
    createdAt: entry.createdAt,
  };
}

function repositoryError(
  c: Context<OrdersPaymentsApiEnv>,
  error: OrdersRepositoryError,
) {
  const status =
    error.code === 'FORBIDDEN'
      ? 403
      : error.code === 'NOT_FOUND'
        ? 404
        : error.code === 'CONFLICT'
          ? 409
          : 400;
  return errorResponse(c, status, error.code, error.message);
}

/**
 * 注文機能だけを独立して公開するHono app。
 * 中央appへ接続した場合は親appのauthを利用し、注文app自身でtenantを暗黙選択しない。
 */
export function createOrdersPaymentsApp(
  options: OrdersPaymentsAppOptions,
): Hono<OrdersPaymentsApiEnv> {
  const app = new Hono<OrdersPaymentsApiEnv>();
  if (!options.useCentralAuth)
    app.use('*', async (c, next) => {
      c.set('requestId', c.req.header('x-request-id') ?? crypto.randomUUID());
      c.header('x-request-id', c.get('requestId'));
      await next();
    });
  app.onError((error, c) => {
    if (error instanceof AuthContextError)
      return errorResponse(c, 401, 'UNAUTHENTICATED', '認証が必要です。');
    if (error instanceof InputError)
      return errorResponse(c, 400, 'VALIDATION_ERROR', error.message);
    if (error instanceof OrdersRepositoryError)
      return repositoryError(c, error);
    if (error instanceof HTTPException) return error.getResponse();
    return errorResponse(
      c,
      500,
      'INTERNAL_SERVER_ERROR',
      '予期しないエラーが発生しました。',
    );
  });

  const authenticate: MiddlewareHandler<OrdersPaymentsApiEnv> = async (
    c,
    next,
  ) => {
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

  if (!options.useCentralAuth) {
    app.use('/api/v1/orders', authenticate);
    app.use('/api/v1/orders/*', authenticate);
  }

  app.get('/api/v1/orders', async (c) => {
    const parsed = orderListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw new InputError('一覧条件が不正です。');
    const auth = getOrdersAuth(c);
    try {
      const campaigns = await options.ordersRepository.listCampaigns({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
        status: parsed.data.status,
      });
      return c.json({ data: campaigns.map(projectCampaign) });
    } catch (error) {
      if (error instanceof OrdersRepositoryError)
        return repositoryError(c, error);
      throw error;
    }
  });

  app.post('/api/v1/orders', async (c) => {
    const parsed = orderCreateSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new InputError('募集案件の入力値が不正です。');
    const auth = getOrdersAuth(c);
    try {
      const campaign = await options.ordersRepository.createCampaign(
        {
          tenantId: auth.membership.tenantId,
          actorUserId: auth.userId,
          role: auth.membership.role,
          idempotencyKey: idempotencyKey(c),
        },
        parsed.data,
      );
      return c.json({ data: projectCampaign(campaign) }, 201);
    } catch (error) {
      if (error instanceof OrdersRepositoryError)
        return repositoryError(c, error);
      throw error;
    }
  });

  app.get('/api/v1/orders/:orderId', async (c) => {
    const orderId = resourceId(c, 'orderId');
    const auth = getOrdersAuth(c);
    try {
      const campaign = await options.ordersRepository.getCampaign({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
        orderId,
      });
      return c.json({ data: projectCampaign(campaign) });
    } catch (error) {
      if (error instanceof OrdersRepositoryError)
        return repositoryError(c, error);
      throw error;
    }
  });

  app.post('/api/v1/orders/:orderId/products', async (c) => {
    const orderId = resourceId(c, 'orderId');
    const parsed = orderProductSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new InputError('商品の入力値が不正です。');
    const auth = getOrdersAuth(c);
    try {
      const product = await options.ordersRepository.addProduct(
        {
          tenantId: auth.membership.tenantId,
          actorUserId: auth.userId,
          role: auth.membership.role,
          orderId,
          idempotencyKey: idempotencyKey(c),
        },
        parsed.data,
      );
      return c.json({ data: product }, 201);
    } catch (error) {
      if (error instanceof OrdersRepositoryError)
        return repositoryError(c, error);
      throw error;
    }
  });

  app.patch('/api/v1/orders/:orderId/status', async (c) => {
    const orderId = resourceId(c, 'orderId');
    const parsed = orderStatusUpdateSchema.safeParse(await readJson(c));
    if (!parsed.success)
      throw new InputError('募集案件状態の入力値が不正です。');
    const auth = getOrdersAuth(c);
    try {
      const campaign = await options.ordersRepository.updateCampaignStatus({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
        orderId,
        status: parsed.data.status,
        idempotencyKey: idempotencyKey(c),
      });
      return c.json({ data: projectCampaign(campaign) });
    } catch (error) {
      if (error instanceof OrdersRepositoryError)
        return repositoryError(c, error);
      throw error;
    }
  });

  app.get('/api/v1/orders/:orderId/entries', async (c) => {
    const orderId = resourceId(c, 'orderId');
    const parsed = paymentStatusQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw new InputError('支払状態の絞り込みが不正です。');
    const auth = getOrdersAuth(c);
    try {
      const entries = await options.ordersRepository.listEntries({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
        orderId,
        paymentStatus: parsed.data.paymentStatus,
      });
      return c.json({
        data: entries.map((entry) => projectEntry(entry, auth.membership.role)),
      });
    } catch (error) {
      if (error instanceof OrdersRepositoryError)
        return repositoryError(c, error);
      throw error;
    }
  });

  app.post('/api/v1/orders/:orderId/entries', async (c) => {
    const orderId = resourceId(c, 'orderId');
    const parsed = orderEntryCreateSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new InputError('注文の入力値が不正です。');
    const auth = getOrdersAuth(c);
    const subjectMemberId = getSubjectMemberId(parsed.data);
    if (!subjectMemberId)
      throw new InputError('対象memberが指定されていません。');
    try {
      const entry = await options.ordersRepository.createEntry({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
        orderId,
        idempotencyKey: idempotencyKey(c),
        entry: { ...parsed.data, memberId: subjectMemberId },
      });
      return c.json({ data: projectEntry(entry, auth.membership.role) }, 201);
    } catch (error) {
      if (error instanceof OrdersRepositoryError)
        return repositoryError(c, error);
      throw error;
    }
  });

  app.patch('/api/v1/orders/:orderId/entries/:entryId/payment', async (c) => {
    const orderId = resourceId(c, 'orderId');
    const entryId = resourceId(c, 'entryId');
    const parsed = paymentUpdateSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new InputError('支払状態の入力値が不正です。');
    const auth = getOrdersAuth(c);
    try {
      const entry = await options.ordersRepository.updatePayment({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
        orderId,
        entryId,
        status: parsed.data.status,
        idempotencyKey: idempotencyKey(c),
      });
      return c.json({ data: projectEntry(entry, auth.membership.role) });
    } catch (error) {
      if (error instanceof OrdersRepositoryError)
        return repositoryError(c, error);
      throw error;
    }
  });

  app.get('/api/v1/orders/:orderId/summary', async (c) => {
    const orderId = resourceId(c, 'orderId');
    const auth = getOrdersAuth(c);
    try {
      const summary = await options.ordersRepository.summarize({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
        orderId,
      });
      return c.json({ data: summary });
    } catch (error) {
      if (error instanceof OrdersRepositoryError)
        return repositoryError(c, error);
      throw error;
    }
  });

  app.get('/api/v1/orders/:orderId/unpaid', async (c) => {
    const orderId = resourceId(c, 'orderId');
    const auth = getOrdersAuth(c);
    try {
      const entries = await options.ordersRepository.listEntries({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
        orderId,
        paymentStatus: 'unpaid',
      });
      return c.json({
        data: entries.map((entry) => projectEntry(entry, auth.membership.role)),
      });
    } catch (error) {
      if (error instanceof OrdersRepositoryError)
        return repositoryError(c, error);
      throw error;
    }
  });

  app.get('/api/v1/orders/:orderId/export.csv', async (c) => {
    const orderId = resourceId(c, 'orderId');
    const auth = getOrdersAuth(c);
    try {
      const csv = await options.ordersRepository.exportCsv({
        tenantId: auth.membership.tenantId,
        actorUserId: auth.userId,
        role: auth.membership.role,
        orderId,
      });
      c.header('Content-Type', 'text/csv; charset=utf-8');
      c.header('Content-Disposition', 'attachment; filename="orders.csv"');
      return c.body(csv);
    } catch (error) {
      if (error instanceof OrdersRepositoryError)
        return repositoryError(c, error);
      throw error;
    }
  });

  return app;
}
