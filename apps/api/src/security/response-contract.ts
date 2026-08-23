import {
  errorResponseSchema,
  type RuntimeResponseSchema,
} from '@cocolo/contracts/runtime-response';
import type { Context, MiddlewareHandler } from 'hono';
import { contextRequestId } from './request-id.js';

export type ResponseContract = {
  method: string;
  path: RegExp;
  status: number;
  schema: RuntimeResponseSchema | ((context: Context) => RuntimeResponseSchema);
};

export type ResponseContractViolation = {
  method: string;
  path: string;
  status: number;
  requestId: string;
};

export type NonJsonResponseContract = {
  method: string;
  path: RegExp;
  status: number;
};

export type ResponseContractOptions = {
  contracts: readonly ResponseContract[];
  allowedNonJson?: readonly NonJsonResponseContract[];
  onViolation?: (violation: ResponseContractViolation) => void;
};

function internalError(c: Parameters<MiddlewareHandler>[0]) {
  const id = contextRequestId(c);
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

function matchesPath(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

function matchesResponse(
  response: NonJsonResponseContract,
  method: string,
  path: string,
  status: number,
): boolean {
  return (
    response.method.toUpperCase() === method.toUpperCase() &&
    response.status === status &&
    matchesPath(response.path, path)
  );
}

// 公開JSONを送信前に検証し、契約不一致や未登録routeは内部エラーへ置換する。
export function createResponseContractMiddleware(
  options: ResponseContractOptions,
): MiddlewareHandler {
  if (!options.contracts.length)
    throw new Error('公開レスポンス契約が一つも登録されていません。');

  return async (c, next) => {
    await next();
    const path = new URL(c.req.url).pathname;
    if (!path.startsWith('/api/v1')) return;

    const violation = {
      method: c.req.method,
      path,
      status: c.res.status,
      requestId: contextRequestId(c),
    };
    if (
      !isJsonResponse(c.res) &&
      !options.allowedNonJson?.some((item) =>
        matchesResponse(item, c.req.method, path, c.res.status),
      )
    ) {
      options.onViolation?.(violation);
      internalError(c);
      return;
    }
    if (!isJsonResponse(c.res)) return;

    const contract = options.contracts.find(
      (item) =>
        item.method.toUpperCase() === c.req.method.toUpperCase() &&
        item.status === c.res.status &&
        matchesPath(item.path, path),
    );
    const schema =
      typeof contract?.schema === 'function'
        ? contract.schema(c)
        : (contract?.schema ??
          (c.res.status >= 400 ? errorResponseSchema : null));
    if (!schema) {
      options.onViolation?.(violation);
      internalError(c);
      return;
    }

    let body: unknown;
    try {
      body = await c.res.clone().json();
    } catch {
      options.onViolation?.(violation);
      internalError(c);
      return;
    }
    if (!schema.safeParse(body).success) {
      options.onViolation?.(violation);
      internalError(c);
    }
  };
}
