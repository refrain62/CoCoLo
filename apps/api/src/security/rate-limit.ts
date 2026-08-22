import { createHash } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';

export const rateLimitPolicies = {
  authenticated: { limit: 60, windowMs: 60_000 },
  uploadSession: { limit: 10, windowMs: 60_000 },
} as const;

export type RateLimitIdentity =
  | { kind: 'user'; tenantId: string; userId: string }
  | { kind: 'client'; clientId: string; ipAddress: string };

export type RateLimitNamespace = 'local' | 'staging' | 'production';

export type RateLimitKeyResolver = (
  c: Context,
) => RateLimitIdentity | null | Promise<RateLimitIdentity | null>;

export type RateLimitConsumeInput = {
  key: string;
  limit: number;
  windowMs: number;
  nowMs: number;
};

export type RateLimitConsumeResult = {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
};

export type RateLimitConsumeOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type RateLimitConsumeContext = {
  signal: AbortSignal;
  timeoutMs: number;
};

export type RateLimitStore = {
  consume: (
    input: RateLimitConsumeInput,
    options?: RateLimitConsumeOptions,
  ) => RateLimitConsumeResult | Promise<RateLimitConsumeResult>;
  readonly distributed: boolean;
};

export type CentralRateLimitStore = RateLimitStore & {
  readonly distributed: boolean;
};

export const DEFAULT_RATE_LIMIT_TIMEOUT_MS = 1_000;
const MAX_RATE_LIMIT_TIMEOUT_MS = 60_000;

export function normalizeRateLimitTimeout(
  timeoutMs = DEFAULT_RATE_LIMIT_TIMEOUT_MS,
): number {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_RATE_LIMIT_TIMEOUT_MS
  )
    throw new Error('rate limitのtimeoutが不正です。');
  return timeoutMs;
}

// 外部storeがsignalを無視しても、timeoutまたはrequest abortで呼び出し側を必ず解放する。
export function withRateLimitTimeout<T>(
  operation: (context: RateLimitConsumeContext) => T | Promise<T>,
  options: RateLimitConsumeOptions = {},
): Promise<T> {
  const timeoutMs = normalizeRateLimitTimeout(options.timeoutMs);
  const parentSignal = options.signal;
  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (parentSignal)
        parentSignal.removeEventListener('abort', onParentAbort);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const rejectWithAbort = (reason: unknown) => {
      const error =
        reason instanceof Error
          ? reason
          : new Error('rate limit storeへの要求が中断されました。');
      if (!controller.signal.aborted) controller.abort(error);
      finish(() => reject(error));
    };
    const onParentAbort = () => rejectWithAbort(parentSignal?.reason);

    if (parentSignal?.aborted) {
      rejectWithAbort(parentSignal.reason);
      return;
    }
    parentSignal?.addEventListener('abort', onParentAbort, { once: true });
    timer = setTimeout(() => {
      const error = new Error('rate limit storeへの要求がtimeoutしました。');
      error.name = 'RateLimitTimeoutError';
      if (!controller.signal.aborted) controller.abort(error);
      finish(() => reject(error));
    }, timeoutMs);

    Promise.resolve()
      .then(() => {
        if (settled)
          throw new Error('rate limit storeへの要求は終了しています。');
        return operation({ signal: controller.signal, timeoutMs });
      })
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
  });
}

type Counter = { count: number; resetAtMs: number };

// ローカル検証用の固定窓実装。本番の複数instanceでは分散ストアへ差し替える。
export class InMemoryRateLimitStore implements RateLimitStore {
  readonly distributed = false;
  private readonly counters = new Map<string, Counter>();
  private readonly maxEntries: number;

  constructor(maxEntries = 10_000) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1)
      throw new Error('rate limit storeの最大件数が不正です。');
    this.maxEntries = maxEntries;
  }

  consume(input: RateLimitConsumeInput): RateLimitConsumeResult {
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

function hashPart(value: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    hasUnsafeControlCharacter(normalized) ||
    normalized.includes('|')
  )
    throw new Error('rate limit identityが不正です。');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function hashIdentityParts(parts: readonly unknown[]): string {
  const normalized = parts.map((part) => {
    if (typeof part !== 'string')
      throw new Error('rate limit identityが不正です。');
    const value = part.trim();
    if (!value || hasUnsafeControlCharacter(value) || value.includes('|'))
      throw new Error('rate limit identityが不正です。');
    return value;
  });
  return hashPart(JSON.stringify(normalized));
}

// tenantとuserの組を必須にし、IPアドレスだけをrate limitの認証根拠にしない。
export function createRateLimitKey(
  scope: string,
  identity: RateLimitIdentity,
): string;
export function createRateLimitKey(
  namespace: RateLimitNamespace,
  scope: string,
  identity: RateLimitIdentity,
): string;
export function createRateLimitKey(
  namespaceOrScope: string,
  scopeOrIdentity: string | RateLimitIdentity,
  maybeIdentity?: RateLimitIdentity,
): string {
  const namespace = maybeIdentity ? namespaceOrScope : 'local';
  const scope = maybeIdentity ? (scopeOrIdentity as string) : namespaceOrScope;
  const identity = maybeIdentity ?? (scopeOrIdentity as RateLimitIdentity);
  if (
    namespace !== 'local' &&
    namespace !== 'staging' &&
    namespace !== 'production'
  )
    throw new Error('rate limit namespaceが不正です。');
  const scopeHash = hashPart(scope);
  if (identity.kind === 'user')
    return `user:${namespace}:${scopeHash}:${hashIdentityParts([identity.tenantId, identity.userId])}`;
  return `client:${namespace}:${scopeHash}:${hashIdentityParts([identity.clientId, identity.ipAddress])}`;
}

function requestId(c: Context): string {
  const candidate = c.req.header('x-request-id')?.trim();
  if (
    candidate &&
    candidate.length <= 128 &&
    !hasUnsafeControlCharacter(candidate)
  )
    return candidate;
  return crypto.randomUUID();
}

function hasUnsafeControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function rateLimitError(c: Context, status: 429 | 503, code: string) {
  const id = requestId(c);
  c.header('x-request-id', id);
  return c.json(
    {
      error: {
        code,
        message:
          status === 429
            ? 'リクエスト数の上限を超えました。'
            : 'レート制限を適用できないため処理を停止しました。',
        details: {},
        requestId: id,
      },
    },
    status,
  );
}

export type RateLimitOptions = {
  scope: string;
  limit: number;
  windowMs: number;
  keyResolver: RateLimitKeyResolver;
  store?: RateLimitStore;
  now?: () => number;
  namespace?: RateLimitNamespace;
  timeoutMs?: number;
};

// 認証後にtenant/userキーを解決してから消費し、store障害やidentity欠落は503で停止する。
export function createRateLimitMiddleware(
  options: RateLimitOptions,
): MiddlewareHandler {
  if (!Number.isInteger(options.limit) || options.limit < 1)
    throw new Error('rate limitの上限が不正です。');
  if (!Number.isInteger(options.windowMs) || options.windowMs < 1)
    throw new Error('rate limitの期間が不正です。');
  const store = options.store ?? new InMemoryRateLimitStore();
  const now = options.now ?? Date.now;
  const namespace = options.namespace ?? 'local';
  const timeoutMs = normalizeRateLimitTimeout(options.timeoutMs);

  return async (c, next) => {
    let identity: RateLimitIdentity | null;
    try {
      identity = await options.keyResolver(c);
    } catch {
      return rateLimitError(c, 503, 'RATE_LIMIT_IDENTITY_UNAVAILABLE');
    }
    if (!identity)
      return rateLimitError(c, 503, 'RATE_LIMIT_IDENTITY_UNAVAILABLE');

    let result: RateLimitConsumeResult;
    try {
      const input = {
        key: createRateLimitKey(namespace, options.scope, identity),
        limit: options.limit,
        windowMs: options.windowMs,
        nowMs: now(),
      };
      result = await withRateLimitTimeout(
        (context) => store.consume(input, context),
        { signal: c.req.raw.signal, timeoutMs },
      );
    } catch {
      return rateLimitError(c, 503, 'RATE_LIMIT_UNAVAILABLE');
    }

    c.header('X-RateLimit-Limit', String(options.limit));
    c.header('X-RateLimit-Remaining', String(result.remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(result.resetAtMs / 1000)));
    if (!result.allowed) {
      c.header(
        'Retry-After',
        String(Math.max(1, Math.ceil((result.resetAtMs - now()) / 1000))),
      );
      return rateLimitError(c, 429, 'RATE_LIMIT_EXCEEDED');
    }
    await next();
  };
}
