export type LineTargetType = 'group' | 'official_account';
export type LineNotificationType = 'schedule' | 'deadline' | 'announcement';
export type LineNotificationState = 'queued' | 'sending' | 'sent' | 'failed';

export type LineBinding = {
  id: string;
  tenantId: string;
  targetType: LineTargetType;
  targetId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type LineNotification = {
  id: string;
  tenantId: string;
  targetType: LineTargetType;
  targetId: string;
  eventType: LineNotificationType;
  eventId: string;
  dedupeKey: string;
  title: string;
  body: string;
  deepLink: string | null;
  state: LineNotificationState;
  attempts: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  nextAttemptAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export class LineDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LineDomainError';
  }
}

const targetIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,254}$/;
const groupIdPattern = /^C[A-Za-z0-9_-]{2,254}$/;
const eventIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sensitiveQueryKeyPattern =
  /(token|secret|password|authorization|refresh|access|code|key)/i;
const allowedDeepLinkPrefixes = [
  '/events/',
  '/announcements/',
  '/line-notifications/',
];

function hasControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

export const LINE_NOTIFICATION_MAX_ATTEMPTS = 3;

export function normalizeLineTargetId(
  targetType: LineTargetType,
  targetId: string,
): string {
  const normalized = targetId.trim();
  if (!targetIdPattern.test(normalized))
    throw new LineDomainError(
      'LINE_TARGET_INVALID',
      'LINE送信先IDが不正です。',
    );
  if (targetType === 'group' && !groupIdPattern.test(normalized))
    throw new LineDomainError(
      'LINE_GROUP_ID_INVALID',
      'LINEグループIDが不正です。',
    );
  return normalized;
}

export function createLineDedupeKey(input: {
  tenantId: string;
  eventType: LineNotificationType;
  eventId: string;
}): string {
  if (!input.tenantId || !eventIdPattern.test(input.eventId))
    throw new LineDomainError(
      'LINE_DEDUPE_KEY_INVALID',
      '通知の重複排除キーが不正です。',
    );
  return `line:${input.tenantId}:${input.eventType}:${input.eventId}`;
}

function parseBaseUrl(publicAppUrl: string): URL {
  let url: URL;
  try {
    url = new URL(publicAppUrl);
  } catch {
    throw new LineDomainError(
      'LINE_APP_URL_INVALID',
      '公開アプリURLが不正です。',
    );
  }
  if (
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
      )) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new LineDomainError(
      'LINE_APP_URL_INVALID',
      '公開アプリURLは安全なoriginだけを指定してください。',
    );
  return url;
}

export function normalizeLineDeepLinkPath(path: string): string {
  const normalized = path.trim();
  if (
    !normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    normalized.includes('\\') ||
    hasControlCharacter(normalized)
  )
    throw new LineDomainError(
      'LINE_DEEP_LINK_INVALID',
      '通知リンクが不正です。',
    );

  const url = new URL(normalized, 'https://line-link.invalid');
  if (
    url.origin !== 'https://line-link.invalid' ||
    url.username ||
    url.password ||
    url.hash ||
    !allowedDeepLinkPrefixes.some((prefix) => url.pathname.startsWith(prefix))
  )
    throw new LineDomainError(
      'LINE_DEEP_LINK_INVALID',
      '通知リンクはアプリ内の許可された画面だけを指定してください。',
    );
  for (const key of url.searchParams.keys())
    if (sensitiveQueryKeyPattern.test(key))
      throw new LineDomainError(
        'LINE_DEEP_LINK_INVALID',
        '通知リンクへ認証情報を含めることはできません。',
      );
  return `${url.pathname}${url.search}`;
}

export function buildLineAppDeepLink(
  publicAppUrl: string,
  path: string,
): string {
  const base = parseBaseUrl(publicAppUrl);
  const normalizedPath = normalizeLineDeepLinkPath(path);
  return new URL(normalizedPath, base).toString();
}

export function buildLineLiffDeepLink(liffId: string, path: string): string {
  const normalizedId = liffId.trim();
  if (!/^\d{8,13}-[A-Za-z0-9]{4,64}$/.test(normalizedId))
    throw new LineDomainError('LINE_LIFF_ID_INVALID', 'LIFF IDが不正です。');
  return `https://liff.line.me/${normalizedId}${normalizeLineDeepLinkPath(path)}`;
}

export function buildLineTextMessage(input: {
  title: string;
  body: string;
  deepLink?: string | null;
}): string {
  const text = [
    input.title.trim(),
    input.body.trim(),
    input.deepLink ? `開く: ${input.deepLink}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n');
  if (!text || text.length > 5000)
    throw new LineDomainError(
      'LINE_MESSAGE_INVALID',
      'LINE通知本文は1〜5000文字で指定してください。',
    );
  return text;
}

export function canTransitionLineNotificationState(
  from: LineNotificationState,
  to: LineNotificationState,
): boolean {
  return (
    (from === 'queued' && to === 'sending') ||
    (from === 'sending' && (to === 'sent' || to === 'failed')) ||
    (from === 'failed' && to === 'queued')
  );
}

export function calculateLineRetryAt(now: Date, attempts: number): Date | null {
  if (attempts >= LINE_NOTIFICATION_MAX_ATTEMPTS) return null;
  const delayMs = Math.min(5 * 60_000, 2 ** Math.max(0, attempts - 1) * 30_000);
  return new Date(now.getTime() + delayMs);
}

export function safeLineErrorCode(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]{1,64}$/.test(error.code)
  )
    return error.code;
  return 'LINE_SEND_FAILED';
}
