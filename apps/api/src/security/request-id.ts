import type { Context } from 'hono';

export function hasUnsafeControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isValidRequestId(value: string): boolean {
  return (
    value.length > 0 && value.length <= 128 && !hasUnsafeControlCharacter(value)
  );
}

// requestIdは最初のmiddlewareで確定し、後続処理は同じ値を相関に使う。
export function resolveRequestId(request: Request): string {
  const candidate = request.headers.get('x-request-id')?.trim();
  return candidate && isValidRequestId(candidate)
    ? candidate
    : crypto.randomUUID();
}

export function contextRequestId(c: Context): string {
  const value = c.get('requestId');
  return typeof value === 'string' && isValidRequestId(value)
    ? value
    : resolveRequestId(c.req.raw);
}
