import type { Context } from 'hono';

export function hasUnsafeControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isValidRequestId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
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
