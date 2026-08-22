import {
  errorResponseSchema,
  type RuntimeResponseSchema,
} from '@cocolo/contracts/runtime-response';
import type { MiddlewareHandler } from 'hono';

export type ResponseContract = {
  method: string;
  path: RegExp;
  status: number;
  schema: RuntimeResponseSchema;
};

export type ResponseContractViolation = {
  method: string;
  path: string;
  status: number;
};

export type ResponseContractOptions = {
  contracts: readonly ResponseContract[];
  onViolation?: (violation: ResponseContractViolation) => void;
};

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

function internalError(c: Parameters<MiddlewareHandler>[0]) {
  const id = requestId(c.req.raw);
  c.res = new Response(
    JSON.stringify({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: '公開レスポンスを検証できませんでした。',
        details: {},
        requestId: id,
      },
    }),
    {
      status: 500,
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'x-request-id': id,
      },
    },
  );
}

function isJsonResponse(response: Response): boolean {
  return (
    response.headers
      .get('content-type')
      ?.toLowerCase()
      .includes('application/json') ?? false
  );
}

function matchesPath(pattern: RegExp, path: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(path);
}

// 公開APIのJSONを送信前に検証し、契約不一致や未登録routeは内部エラーへ置換して外部へ返さない。
export function createResponseContractMiddleware(
  options: ResponseContractOptions,
): MiddlewareHandler {
  if (!options.contracts.length)
    throw new Error('公開レスポンス契約が一つも登録されていません。');

  return async (c, next) => {
    await next();
    const path = new URL(c.req.url).pathname;
    if (
      !path.startsWith('/api/v1') ||
      c.res.status === 204 ||
      !isJsonResponse(c.res)
    )
      return;

    const contract = options.contracts.find(
      (item) =>
        item.method.toUpperCase() === c.req.method.toUpperCase() &&
        item.status === c.res.status &&
        matchesPath(item.path, path),
    );
    const schema =
      contract?.schema ?? (c.res.status >= 400 ? errorResponseSchema : null);
    if (!schema) {
      options.onViolation?.({
        method: c.req.method,
        path,
        status: c.res.status,
      });
      internalError(c);
      return;
    }

    let body: unknown;
    try {
      body = await c.res.clone().json();
    } catch {
      options.onViolation?.({
        method: c.req.method,
        path,
        status: c.res.status,
      });
      internalError(c);
      return;
    }
    if (!schema.safeParse(body).success) {
      options.onViolation?.({
        method: c.req.method,
        path,
        status: c.res.status,
      });
      internalError(c);
    }
  };
}
