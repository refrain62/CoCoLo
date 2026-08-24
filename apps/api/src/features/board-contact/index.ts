import { extractBearerToken, type TokenVerifier } from '@cocolo/auth';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import {
  type BoardContactCreateInput,
  type BoardContactListQuery,
  type BoardContactPatchInput,
  type BoardContactRoleType,
  BoardContactValidationError,
  type ContactPreference,
  type CopyBoardContactYearInput,
  parseBoardContactCreateInput,
  parseBoardContactId,
  parseBoardContactListQuery,
  parseBoardContactPatchInput,
  parseCopyBoardContactYearInput,
} from './board-contact-validation.js';

export type BoardContactMembership = {
  tenantId: string;
  role: BoardContactViewerRole;
};

export type BoardContactViewerRole = 'owner' | 'admin' | 'staff' | 'guardian';

export type BoardContactRecord = {
  id: string;
  tenantId: string;
  fiscalYear: number;
  roleName: string;
  roleType: BoardContactRoleType;
  assigneeUserId: string | null;
  lineContact: string | null;
  phone: string | null;
  contactPreference: ContactPreference;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type BoardContactRepository = {
  list: (input: {
    tenantId: string;
    actorUserId: string;
    role: BoardContactViewerRole;
    query: BoardContactListQuery;
  }) => Promise<BoardContactRecord[]>;
  create: (input: {
    tenantId: string;
    actorUserId: string;
    role: 'owner' | 'admin';
    contact: BoardContactCreateInput;
  }) => Promise<BoardContactRecord>;
  update: (input: {
    tenantId: string;
    actorUserId: string;
    role: 'owner' | 'admin';
    boardContactId: string;
    patch: BoardContactPatchInput;
  }) => Promise<BoardContactRecord | null>;
  remove: (input: {
    tenantId: string;
    actorUserId: string;
    role: 'owner' | 'admin';
    boardContactId: string;
  }) => Promise<BoardContactRecord | null>;
  copyYear: (input: {
    tenantId: string;
    actorUserId: string;
    role: 'owner' | 'admin';
    fromFiscalYear: number;
    toFiscalYear: number;
  }) => Promise<BoardContactRecord[]>;
};

export type BoardContactAppOptions = {
  verifyToken?: TokenVerifier;
  membershipRepository?: {
    findActiveByUserId: (
      userId: string,
    ) => Promise<BoardContactMembership | null>;
  };
  boardContactRepository?: BoardContactRepository;
  useCentralAuth?: boolean;
};

type BoardContactApiEnv = {
  Variables: {
    requestId: string;
    auth: { userId: string; membership: BoardContactMembership };
  };
};

const managerRoles = new Set<BoardContactViewerRole>(['owner', 'admin']);

function isManager(role: BoardContactViewerRole): role is 'owner' | 'admin' {
  return managerRoles.has(role);
}

function errorResponse(
  c: Context<BoardContactApiEnv>,
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

function isoDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

// APIレスポンスからtenantと個人連絡先を既定で除外し、managerにも設定済みの項目だけを返す。
function projectBoardContact(
  contact: BoardContactRecord,
  viewerRole: BoardContactViewerRole,
) {
  const projected: {
    id: string;
    fiscalYear: number;
    roleName: string;
    roleType: BoardContactRoleType;
    contactPreference: ContactPreference;
    assigneeUserId?: string;
    lineContact?: string;
    phone?: string;
    createdAt: string;
    updatedAt: string;
  } = {
    id: contact.id,
    fiscalYear: contact.fiscalYear,
    roleName: contact.roleName,
    roleType: contact.roleType,
    contactPreference: contact.contactPreference,
    createdAt: isoDate(contact.createdAt),
    updatedAt: isoDate(contact.updatedAt),
  };
  if (!isManager(viewerRole)) return projected;
  if (contact.assigneeUserId) projected.assigneeUserId = contact.assigneeUserId;
  if (
    (contact.contactPreference === 'line' ||
      contact.contactPreference === 'both') &&
    contact.lineContact
  )
    projected.lineContact = contact.lineContact;
  if (
    (contact.contactPreference === 'phone' ||
      contact.contactPreference === 'both') &&
    contact.phone
  )
    projected.phone = contact.phone;
  return projected;
}

async function readJson(c: Context<BoardContactApiEnv>) {
  try {
    return await c.req.json();
  } catch {
    throw new BoardContactValidationError('JSON入力が不正です。');
  }
}

function repositoryUnavailable(
  c: Context<BoardContactApiEnv>,
  message = '役員データストアが設定されていません。',
) {
  return errorResponse(c, 503, 'DEPENDENCY_UNAVAILABLE', message);
}

// 中央appへ未接続でも単独でmountできるfeature app。認証所属からtenantを解決し、入力のtenantIdを利用しない。
export function createBoardContactApp(
  options: BoardContactAppOptions = {},
): Hono<BoardContactApiEnv> {
  const app = new Hono<BoardContactApiEnv>();

  if (!options.useCentralAuth)
    app.use('*', async (c, next) => {
      const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
      c.set('requestId', requestId);
      c.header('x-request-id', requestId);
      await next();
    });

  app.onError((error, c) => {
    if (error instanceof BoardContactValidationError)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        error.message,
        error.details,
      );
    if (error instanceof Error && 'status' in error) {
      if (error.status === 403)
        return errorResponse(c, 403, 'FORBIDDEN', error.message);
      if (error.status === 409)
        return errorResponse(c, 409, 'BOARD_CONTACT_CONFLICT', error.message);
    }
    return errorResponse(
      c,
      500,
      'INTERNAL_SERVER_ERROR',
      '予期しないエラーが発生しました。',
    );
  });

  const authenticate: MiddlewareHandler<BoardContactApiEnv> = async (
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
    app.use('/api/v1/board-members', authenticate);
    app.use('/api/v1/board-members/*', authenticate);
  }

  app.get('/api/v1/board-members', async (c) => {
    if (!options.boardContactRepository) return repositoryUnavailable(c);
    const query = parseBoardContactListQuery(c.req.query());
    const auth = c.get('auth');
    const records = await options.boardContactRepository.list({
      tenantId: auth.membership.tenantId,
      actorUserId: auth.userId,
      role: auth.membership.role,
      query,
    });
    return c.json({
      data: records.map((record) =>
        projectBoardContact(record, auth.membership.role),
      ),
      fiscalYear: query.fiscalYear ?? null,
    });
  });

  app.post('/api/v1/board-members', async (c) => {
    if (!options.boardContactRepository) return repositoryUnavailable(c);
    const auth = c.get('auth');
    if (!isManager(auth.membership.role))
      return errorResponse(
        c,
        403,
        'FORBIDDEN',
        '役員を管理する権限がありません。',
      );
    const input = parseBoardContactCreateInput(await readJson(c));
    const record = await options.boardContactRepository.create({
      tenantId: auth.membership.tenantId,
      actorUserId: auth.userId,
      role: auth.membership.role,
      contact: input,
    });
    return c.json(
      { data: projectBoardContact(record, auth.membership.role) },
      201,
    );
  });

  app.post('/api/v1/board-members/copy-year', async (c) => {
    if (!options.boardContactRepository) return repositoryUnavailable(c);
    const auth = c.get('auth');
    if (!isManager(auth.membership.role))
      return errorResponse(
        c,
        403,
        'FORBIDDEN',
        '年度引き継ぎを実行する権限がありません。',
      );
    const input = parseCopyBoardContactYearInput(await readJson(c));
    const records = await options.boardContactRepository.copyYear({
      tenantId: auth.membership.tenantId,
      actorUserId: auth.userId,
      role: auth.membership.role,
      ...input,
    });
    return c.json(
      {
        data: records.map((record) =>
          projectBoardContact(record, auth.membership.role),
        ),
        copiedCount: records.length,
        fromFiscalYear: input.fromFiscalYear,
        toFiscalYear: input.toFiscalYear,
      },
      201,
    );
  });

  app.patch('/api/v1/board-members/:boardMemberId', async (c) => {
    if (!options.boardContactRepository) return repositoryUnavailable(c);
    const auth = c.get('auth');
    if (!isManager(auth.membership.role))
      return errorResponse(
        c,
        403,
        'FORBIDDEN',
        '役員を管理する権限がありません。',
      );
    const boardContactId = parseBoardContactId(c.req.param('boardMemberId'));
    const patch = parseBoardContactPatchInput(await readJson(c));
    const record = await options.boardContactRepository.update({
      tenantId: auth.membership.tenantId,
      actorUserId: auth.userId,
      role: auth.membership.role,
      boardContactId,
      patch,
    });
    if (!record)
      return errorResponse(
        c,
        404,
        'BOARD_CONTACT_NOT_FOUND',
        '役員が見つかりません。',
      );
    return c.json({ data: projectBoardContact(record, auth.membership.role) });
  });

  app.delete('/api/v1/board-members/:boardMemberId', async (c) => {
    if (!options.boardContactRepository) return repositoryUnavailable(c);
    const auth = c.get('auth');
    if (!isManager(auth.membership.role))
      return errorResponse(
        c,
        403,
        'FORBIDDEN',
        '役員を管理する権限がありません。',
      );
    const record = await options.boardContactRepository.remove({
      tenantId: auth.membership.tenantId,
      actorUserId: auth.userId,
      role: auth.membership.role,
      boardContactId: parseBoardContactId(c.req.param('boardMemberId')),
    });
    if (!record)
      return errorResponse(
        c,
        404,
        'BOARD_CONTACT_NOT_FOUND',
        '役員が見つかりません。',
      );
    return c.body(null, 204);
  });

  return app;
}

export type {
  BoardContactListQuery,
  BoardContactPatchInput,
  CopyBoardContactYearInput,
};
