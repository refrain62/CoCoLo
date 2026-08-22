import { extractBearerToken, type TokenVerifier } from '@cocolo/auth';
import type {
  MemberCreateInput,
  MemberListQuery,
  MemberRole,
} from '@cocolo/contracts/member';
import {
  memberCreateSchema,
  memberListQuerySchema,
} from '@cocolo/contracts/member';
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
};

export type AppOptions = {
  verifyToken?: TokenVerifier;
  membershipRepository?: MembershipRepository;
  memberRepository?: MemberRepository;
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

function errorResponse(
  c: Context<ApiEnv>,
  status: 400 | 401 | 403 | 404 | 503,
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

export function createApp(options: AppOptions = {}) {
  const app = new Hono<ApiEnv>();

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
    c.set('requestId', requestId);
    c.header('x-request-id', requestId);
    await next();
  });

  app.get('/health', (c) => c.json({ status: 'ok', service: 'api' }));

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

  return app;
}
