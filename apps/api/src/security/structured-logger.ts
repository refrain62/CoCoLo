import {
  type StructuredLogEntry,
  structuredLogEntrySchema,
} from '@cocolo/contracts/observability';
import type { Context, MiddlewareHandler } from 'hono';

export type LogSink = (line: string) => void;

export type StructuredLogger = {
  write: (entry: StructuredLogEntry) => boolean;
};

// schema検証を通ったJSON一行だけを出力し、秘密情報を含む不正なentryは破棄する。
export function createStructuredLogger(
  sink: LogSink = (line) => console.log(line),
): StructuredLogger {
  return {
    write(entry) {
      const parsed = structuredLogEntrySchema.safeParse(entry);
      if (!parsed.success) return false;
      try {
        sink(JSON.stringify(parsed.data));
        return true;
      } catch {
        return false;
      }
    },
  };
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

function path(c: Context, resolver?: (context: Context) => string): string {
  const value = resolver?.(c) ?? '/unresolved-route';
  if (
    value.length <= 512 &&
    value.startsWith('/') &&
    !value.includes('?') &&
    !hasUnsafeControlCharacter(value)
  )
    return value;
  return '/invalid-path';
}

export type RequestLoggerOptions = {
  logger: StructuredLogger;
  environment: 'local' | 'staging' | 'production';
  now?: () => number;
  pathResolver?: (context: Context) => string;
};

// request body、query、header、IPを記録せず、運用に必要な最小の完了情報だけを出力する。
export function createRequestLoggerMiddleware(
  options: RequestLoggerOptions,
): MiddlewareHandler {
  const now = options.now ?? Date.now;
  return async (c, next) => {
    const startedAt = now();
    let failed = false;
    try {
      await next();
    } catch (error) {
      void error;
      failed = true;
      throw error;
    } finally {
      const status = failed ? 500 : c.res.status;
      options.logger.write({
        timestamp: new Date().toISOString(),
        level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
        event: failed
          ? 'dependency.failure'
          : [401, 403, 429].includes(status)
            ? 'security.denied'
            : 'request.completed',
        service: 'api',
        environment: options.environment,
        requestId: requestId(c),
        method: c.req.method as StructuredLogEntry['method'],
        path: path(c, options.pathResolver),
        status,
        durationMs: Math.max(0, now() - startedAt),
      });
    }
  };
}
