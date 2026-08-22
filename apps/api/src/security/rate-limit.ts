import { createHash } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';

export const rateLimitPolicies = {
  authenticated: { limit: 60, windowMs: 60_000 },
  uploadSession: { limit: 10, windowMs: 60_000 },
} as const;

export type RateLimitIdentity =
  | { kind: 'user'; tenantId: string; userId: string }
  | { kind: 'client'; clientId: string; ipAddress: string };

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

export type RateLimitStore = {
  consume: (
    input: RateLimitConsumeInput,
  ) => RateLimitConsumeResult | Promise<RateLimitConsumeResult>;
};

type Counter = { count: number; resetAtMs: number };

// ローカル検証用の固定窓実装。本番の複数instanceでは分散ストアへ差し替える。
export class InMemoryRateLimitStore implements RateLimitStore {
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
): string {
  const scopeHash = hashPart(scope);
  if (identity.kind === 'user')
    return `user:${scopeHash}:${hashIdentityParts([identity.tenantId, identity.userId])}`;
  return `client:${scopeHash}:${hashIdentityParts([identity.clientId, identity.ipAddress])}`;
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
      result = await store.consume({
        key: createRateLimitKey(options.scope, identity),
        limit: options.limit,
        windowMs: options.windowMs,
        nowMs: now(),
      });
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
