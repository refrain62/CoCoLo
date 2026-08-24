import { extractBearerToken, type TokenVerifier } from '@cocolo/auth';
import {
  parseUploadSessionInput,
  uploadCompleteInputSchema,
  uploadIdSchema,
  uploadSessionInputSchema,
} from '@cocolo/contracts/upload';
import {
  ATTACHMENT_COMPLETE_MAX_ATTEMPTS,
  ATTACHMENT_SESSION_TTL_SECONDS,
  type AttachmentMediaType,
  type AttachmentRepository,
  AttachmentValidationError,
  createAttachmentId,
  validateAttachmentObject,
} from '@cocolo/domain/attachment';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import type { AttachmentStorage } from './attachment-storage.js';

type AttachmentRole = 'owner' | 'admin' | 'staff' | 'guardian';

type MembershipRepository = {
  findActiveByUserId: (
    userId: string,
  ) => Promise<{ tenantId: string; role: AttachmentRole } | null>;
};

export type AttachmentAppOptions = {
  verifyToken?: TokenVerifier;
  membershipRepository?: MembershipRepository;
  attachmentRepository: AttachmentRepository;
  storage: AttachmentStorage;
  useCentralAuth?: boolean;
  now?: () => Date;
  createId?: () => string;
};

type AttachmentApiEnv = {
  Variables: {
    requestId: string;
    auth: {
      userId: string;
      tenantId: string;
      role: AttachmentRole;
    };
  };
};

type AttachmentAuth = {
  userId: string;
  tenantId: string;
  role: AttachmentRole;
};

const uploadRoles = new Set<AttachmentRole>(['owner', 'admin', 'staff']);
const DOWNLOAD_TTL_SECONDS = 300;
const EXPIRED_CLEANUP_LIMIT = 100;

function errorResponse(
  c: Context<AttachmentApiEnv>,
  status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503,
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

function getAttachmentAuth(c: Context<AttachmentApiEnv>): AttachmentAuth {
  const auth = c.get('auth') as unknown as
    | AttachmentAuth
    | { userId: string; membership: Omit<AttachmentAuth, 'userId'> };
  if ('membership' in auth)
    return {
      userId: auth.userId,
      tenantId: auth.membership.tenantId,
      role: auth.membership.role,
    };
  return auth;
}

function isStatusError(error: unknown, status: number): boolean {
  return (
    error instanceof Error &&
    'status' in error &&
    (error as { status?: unknown }).status === status
  );
}

function attachmentResponse(record: {
  id: string;
  status: 'available';
  mediaType: AttachmentMediaType;
  byteSize: number;
  sha256: string | null;
}) {
  if (!record.sha256) throw new Error('available添付のSHA-256がありません。');
  return {
    attachmentId: record.id,
    status: record.status,
    mediaType: record.mediaType,
    byteSize: record.byteSize,
    sha256: record.sha256,
  };
}

async function cleanupRejected(
  options: AttachmentAppOptions,
  input: {
    id: string;
    tenantId: string;
    ownerUserId: string;
    role: AttachmentRole;
    objectKey: string;
  },
): Promise<boolean> {
  try {
    await options.storage.deleteObject({ objectKey: input.objectKey });
    await options.attachmentRepository.recordCleanupAttempt({
      id: input.id,
      tenantId: input.tenantId,
      ownerUserId: input.ownerUserId,
      role: input.role,
      completed: true,
    });
    return true;
  } catch {
    // rejectedメタデータを残し、cleanup endpointから同じキーを再試行できるようにする。
    await options.attachmentRepository
      .recordCleanupAttempt({
        id: input.id,
        tenantId: input.tenantId,
        ownerUserId: input.ownerUserId,
        role: input.role,
        completed: false,
      })
      .catch(() => undefined);
    return false;
  }
}

// Phase 4の中央appへ後でmountできる自己完結router。認証・RLS・ストレージを外から注入する。
export function createAttachmentApp(
  options: AttachmentAppOptions,
): Hono<AttachmentApiEnv> {
  const app = new Hono<AttachmentApiEnv>();
  const now = options.now ?? (() => new Date());
  const createId =
    options.createId ?? (() => createAttachmentId(now().getTime()));

  if (!options.useCentralAuth) {
    app.use('*', async (c, next) => {
      const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
      c.set('requestId', requestId);
      c.header('x-request-id', requestId);
      await next();
    });
  }

  app.onError((error, c) => {
    void error;
    return errorResponse(
      c,
      500,
      'INTERNAL_SERVER_ERROR',
      '予期しないエラーが発生しました。',
    );
  });

  const authenticate: MiddlewareHandler<AttachmentApiEnv> = async (c, next) => {
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
      if (claims.expiresAt <= Math.floor(now().getTime() / 1000))
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
      c.set('auth', {
        userId: claims.userId,
        tenantId: membership.tenantId,
        role: membership.role,
      });
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
    app.use('/api/v1/uploads', authenticate);
    app.use('/api/v1/uploads/*', authenticate);
  }

  app.post('/api/v1/uploads', async (c) => {
    const auth = getAttachmentAuth(c);
    if (!uploadRoles.has(auth.role))
      return errorResponse(
        c,
        403,
        'FORBIDDEN',
        '添付をアップロードする権限がありません。',
      );
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, 'VALIDATION_ERROR', 'JSON入力が不正です。');
    }
    const parsedResult = uploadSessionInputSchema.safeParse(body);
    if (!parsedResult.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'アップロード開始入力が不正です。',
        parsedResult.error.flatten(),
      );
    const parsed = parseUploadSessionInput(parsedResult.data);
    const mediaType = parsed.mediaType as AttachmentMediaType;
    const expiresAt = new Date(
      now().getTime() + ATTACHMENT_SESSION_TTL_SECONDS * 1000,
    );
    const id = createId();
    const objectKey = `${auth.tenantId}/attachments/${id}`;
    let signedUpload: Awaited<
      ReturnType<AttachmentStorage['createSignedUpload']>
    >;
    try {
      signedUpload = await options.storage.createSignedUpload({
        objectKey,
        mediaType,
        byteSize: parsed.byteSize,
        expiresAt,
      });
      if (signedUpload.expiresAt > expiresAt)
        throw new Error(
          '署名URLの期限がアップロードセッションより長く設定されています。',
        );
      await options.attachmentRepository.createSession({
        id,
        tenantId: auth.tenantId,
        ownerUserId: auth.userId,
        role: auth.role,
        objectKey,
        mediaType,
        byteSize: parsed.byteSize,
        expiresAt,
        now: now(),
      });
    } catch {
      return errorResponse(
        c,
        503,
        'STORAGE_UNAVAILABLE',
        'アップロード先を準備できません。',
      );
    }
    return c.json(
      {
        attachmentId: id,
        uploadUrl: signedUpload.url,
        expiresAt: signedUpload.expiresAt.toISOString(),
        maxBytes: 20 * 1024 * 1024,
        mediaType,
      },
      201,
    );
  });

  app.post('/api/v1/uploads/cleanup-expired', async (c) => {
    const auth = getAttachmentAuth(c);
    if (!uploadRoles.has(auth.role))
      return errorResponse(
        c,
        403,
        'FORBIDDEN',
        '期限切れcleanup権限がありません。',
      );
    const expired = await options.attachmentRepository.listExpiredUploaded({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      role: auth.role,
      now: now(),
      limit: EXPIRED_CLEANUP_LIMIT,
    });
    let cleanedCount = 0;
    let pendingCount = 0;
    for (const candidate of expired) {
      const rejected = await options.attachmentRepository.rejectExpired({
        id: candidate.id,
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        role: auth.role,
        now: now(),
      });
      if (!rejected) continue;
      const cleaned = await cleanupRejected(options, {
        id: rejected.id,
        tenantId: rejected.tenantId,
        ownerUserId: rejected.ownerUserId,
        role: auth.role,
        objectKey: rejected.objectKey,
      });
      if (cleaned) cleanedCount += 1;
      else pendingCount += 1;
    }
    return c.json({
      data: { scannedCount: expired.length, cleanedCount, pendingCount },
    });
  });

  app.post('/api/v1/uploads/:id/complete', async (c) => {
    const auth = getAttachmentAuth(c);
    const id = uploadIdSchema.safeParse(c.req.param('id'));
    if (!id.success)
      return errorResponse(c, 400, 'VALIDATION_ERROR', '添付IDが不正です。');
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, 'VALIDATION_ERROR', 'JSON入力が不正です。');
    }
    const parsed = uploadCompleteInputSchema.safeParse(body);
    if (!parsed.success)
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        '完了入力が不正です。',
        parsed.error.flatten(),
      );

    let outcome: Awaited<ReturnType<AttachmentRepository['complete']>>;
    try {
      outcome = await options.attachmentRepository.complete(
        {
          id: id.data,
          tenantId: auth.tenantId,
          ownerUserId: auth.userId,
          role: auth.role,
          now: now(),
        },
        async (record) => {
          try {
            const object = await options.storage.readObject({
              objectKey: record.objectKey,
            });
            if (!object)
              return { kind: 'retryable', reason: 'OBJECT_NOT_READY' } as const;
            const verified = await validateAttachmentObject({
              declaredMediaType: record.mediaType,
              expectedByteSize: parsed.data.byteSize,
              expectedSha256: parsed.data.sha256,
              object,
            });
            return { kind: 'available', ...verified } as const;
          } catch (error) {
            if (error instanceof AttachmentValidationError)
              return { kind: 'rejected', reason: 'OBJECT_INVALID' } as const;
            return {
              kind: 'retryable',
              reason: 'STORAGE_READ_FAILED',
            } as const;
          }
        },
      );
    } catch (error) {
      if (isStatusError(error, 404))
        return errorResponse(c, 404, 'NOT_FOUND', '添付が見つかりません。');
      if (isStatusError(error, 409))
        return errorResponse(
          c,
          409,
          'ATTACHMENT_CONFLICT',
          '添付セッションは再利用できません。',
        );
      throw error;
    }

    if (outcome.cleanupRequired) {
      const cleanupCompleted = await cleanupRejected(options, {
        id: outcome.record.id,
        tenantId: outcome.record.tenantId,
        ownerUserId: outcome.record.ownerUserId,
        role: auth.role,
        objectKey: outcome.record.objectKey,
      });
      if (!cleanupCompleted)
        return errorResponse(
          c,
          503,
          'ATTACHMENT_CLEANUP_PENDING',
          '検証失敗本体の削除に失敗しました。cleanupを再試行してください。',
        );
    }
    if (outcome.state === 'retryable')
      return errorResponse(
        c,
        503,
        'ATTACHMENT_RETRYABLE',
        '添付本体をまだ検証できません。時間を置いて再試行してください。',
        {
          attempts: outcome.record.completeAttempts,
          remainingAttempts:
            ATTACHMENT_COMPLETE_MAX_ATTEMPTS - outcome.record.completeAttempts,
        },
      );
    if (outcome.state === 'rejected')
      return errorResponse(
        c,
        422,
        'ATTACHMENT_REJECTED',
        '添付本体の検証に失敗しました。',
        { reason: outcome.reason },
      );
    return c.json({
      data: attachmentResponse({ ...outcome.record, status: 'available' }),
    });
  });

  app.get('/api/v1/uploads/:id/download', async (c) => {
    const auth = getAttachmentAuth(c);
    const id = uploadIdSchema.safeParse(c.req.param('id'));
    if (!id.success)
      return errorResponse(c, 400, 'VALIDATION_ERROR', '添付IDが不正です。');
    const record = await options.attachmentRepository.findAvailable({
      id: id.data,
      tenantId: auth.tenantId,
      ownerUserId: auth.userId,
      role: auth.role,
    });
    if (!record)
      return errorResponse(c, 404, 'NOT_FOUND', '添付が見つかりません。');
    const expiresAt = new Date(now().getTime() + DOWNLOAD_TTL_SECONDS * 1000);
    const signed = await options.storage.createSignedDownload({
      objectKey: record.objectKey,
      expiresAt,
    });
    if (signed.expiresAt > expiresAt)
      return errorResponse(
        c,
        503,
        'STORAGE_UNAVAILABLE',
        'ダウンロードURLの期限を保証できません。',
      );
    return c.json({
      data: {
        attachmentId: record.id,
        downloadUrl: signed.url,
        expiresAt: signed.expiresAt.toISOString(),
      },
    });
  });

  app.post('/api/v1/uploads/:id/cleanup', async (c) => {
    const auth = getAttachmentAuth(c);
    if (!uploadRoles.has(auth.role))
      return errorResponse(c, 403, 'FORBIDDEN', 'cleanup権限がありません。');
    const id = uploadIdSchema.safeParse(c.req.param('id'));
    if (!id.success)
      return errorResponse(c, 400, 'VALIDATION_ERROR', '添付IDが不正です。');
    const record = await options.attachmentRepository.findRejectedForCleanup({
      id: id.data,
      tenantId: auth.tenantId,
      ownerUserId: auth.userId,
      role: auth.role,
    });
    if (!record)
      return errorResponse(
        c,
        404,
        'NOT_FOUND',
        'cleanup対象の添付が見つかりません。',
      );
    const completed = await cleanupRejected(options, {
      id: record.id,
      tenantId: record.tenantId,
      ownerUserId: record.ownerUserId,
      role: auth.role,
      objectKey: record.objectKey,
    });
    if (!completed)
      return errorResponse(
        c,
        503,
        'ATTACHMENT_CLEANUP_PENDING',
        '削除に失敗しました。時間を置いて再試行してください。',
      );
    return c.json({ data: { attachmentId: record.id, cleaned: true } });
  });

  return app;
}
