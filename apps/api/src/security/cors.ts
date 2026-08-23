import type { MiddlewareHandler } from 'hono';

const allowedMethods = [
  'GET',
  'POST',
  'PATCH',
  'PUT',
  'DELETE',
  'OPTIONS',
] as const;
const allowedHeaders = [
  'Authorization',
  'Content-Type',
  'Idempotency-Key',
  'If-Match',
] as const;

export type CorsOptions = {
  origins: readonly string[];
  methods?: readonly string[];
  headers?: readonly string[];
  maxAgeSeconds?: number;
};

function normalizeOrigin(origin: string): string {
  const value = origin.trim();
  if (!value || value === '*' || value === 'null')
    throw new Error('CORS origin allowlistに不正な値があります。');
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('CORS origin allowlistにはoriginだけを指定してください。');
  return `${url.protocol}//${url.host}`;
}

function splitHeaderList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function setVary(headers: Headers, values: readonly string[]) {
  const current = headers.get('Vary');
  const existing = new Set(
    (current ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
  for (const value of values) existing.add(value);
  headers.set('Vary', [...existing].join(', '));
}

function requestId(request: Request): string {
  const candidate = request.headers.get('x-request-id')?.trim();
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

function rejectCors(c: Parameters<MiddlewareHandler>[0], code: string) {
  const id = requestId(c.req.raw);
  c.header('x-request-id', id);
  return c.json(
    {
      error: {
        code,
        message: '許可されていないCross-Originリクエストです。',
        details: {},
        requestId: id,
      },
    },
    403,
  );
}

function validateAllowedMethods(methods: Set<string>) {
  if (
    !methods.size ||
    [...methods].some(
      (method) =>
        !allowedMethods.includes(method as (typeof allowedMethods)[number]),
    )
  )
    throw new Error('CORS許可メソッドが不正です。');
}

function validateAllowedHeaders(headers: Set<string>) {
  const normalizedAllowedHeaders = allowedHeaders.map((header) =>
    header.toLowerCase(),
  );
  if (
    [...headers].some(
      (header) => !normalizedAllowedHeaders.includes(header.toLowerCase()),
    )
  )
    throw new Error('CORS許可ヘッダーが不正です。');
}

// 認証より前にorigin、preflight method、headerを検査し、未許可のブラウザ経路をfail-closedにする。
export function createCorsMiddleware(options: CorsOptions): MiddlewareHandler {
  if (!options.origins.length)
    throw new Error('CORS origin allowlistが空です。');
  const origins = new Set(options.origins.map(normalizeOrigin));
  const methods = new Set(
    (options.methods ?? allowedMethods).map((method) => method.toUpperCase()),
  );
  const headers = new Set(
    (options.headers ?? allowedHeaders).map((header) => header.toLowerCase()),
  );
  validateAllowedMethods(methods);
  validateAllowedHeaders(headers);

  const maxAgeSeconds = options.maxAgeSeconds ?? 600;
  if (
    !Number.isInteger(maxAgeSeconds) ||
    maxAgeSeconds < 0 ||
    maxAgeSeconds > 86_400
  )
    throw new Error('CORS preflightのmax-ageが不正です。');

  return async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    const origin = c.req.header('origin');
    if (!origin) return next();

    const varyValues =
      c.req.method === 'OPTIONS'
        ? [
            'Origin',
            'Access-Control-Request-Method',
            'Access-Control-Request-Headers',
          ]
        : ['Origin'];
    setVary(c.res.headers, varyValues);

    let normalizedOrigin: string;
    try {
      normalizedOrigin = normalizeOrigin(origin);
    } catch {
      return rejectCors(c, 'CORS_ORIGIN_DENIED');
    }
    if (!origins.has(normalizedOrigin))
      return rejectCors(c, 'CORS_ORIGIN_DENIED');

    const requestedMethod = c.req.header('access-control-request-method');
    const requestedHeaders = splitHeaderList(
      c.req.header('access-control-request-headers'),
    );
    if (c.req.method === 'OPTIONS') {
      if (!requestedMethod || !methods.has(requestedMethod.toUpperCase()))
        return rejectCors(c, 'CORS_METHOD_DENIED');
      if (requestedHeaders.some((header) => !headers.has(header.toLowerCase())))
        return rejectCors(c, 'CORS_HEADER_DENIED');
      c.header('Access-Control-Allow-Origin', normalizedOrigin);
      c.header('Access-Control-Allow-Methods', [...methods].join(', '));
      c.header('Access-Control-Allow-Headers', [...headers].join(', '));
      c.header('Access-Control-Max-Age', String(maxAgeSeconds));
      return c.body(null, 204);
    }

    c.header('Access-Control-Allow-Origin', normalizedOrigin);
    c.header(
      'Access-Control-Expose-Headers',
      'X-Request-Id, ETag, Retry-After',
    );
    await next();
  };
}
