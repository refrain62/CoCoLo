export type LineConnectionStatus = 'connected' | 'disconnected';
export type LineNotificationSource = 'event' | 'deadline' | 'bulletin';
export type LineNotificationStatus = 'pending' | 'sending' | 'sent' | 'failed';

export type LineConnection = {
  tenantId: string;
  groupId: string | null;
  status: LineConnectionStatus;
  connectedAt: Date | null;
  updatedAt: Date;
};

export type LineNotification = {
  id: string;
  tenantId: string;
  groupId: string;
  createdByUserId: string;
  sourceType: LineNotificationSource;
  sourceId: string;
  title: string;
  body: string;
  deepLink: string;
  status: LineNotificationStatus;
  attempts: number;
  nextRetryAt: Date | null;
  providerMessageId: string | null;
  lastError: string | null;
  createdAt: Date;
  sentAt: Date | null;
};

export type LineWebhookReceipt = {
  tenantId: string;
  groupId: string;
  webhookEventId: string;
  receivedAt: Date;
};

export class LineConnectionConflictError extends Error {
  readonly code = 'LINE_GROUP_ALREADY_CONNECTED';

  constructor() {
    super('LINEグループは別のチームへ接続済みです。');
    this.name = 'LineConnectionConflictError';
  }
}

export class LineNotificationStateError extends Error {
  readonly code = 'LINE_NOTIFICATION_STATE_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'LineNotificationStateError';
  }
}

// 外部識別子をURLやSQLへそのまま流さず、契約で受けた値の前後空白を除く。
export function normalizeLineGroupId(groupId: string): string {
  return groupId.trim();
}

// production DBのUUIDv7と同じ形式をlocal repositoryでも使い、時刻順の検証を可能にする。
export function createUuidV7(now = Date.now()): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number((timestamp >> BigInt((5 - index) * 8)) & 0xffn);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function retryDelayMs(attempts: number): number {
  return Math.min(60 * 60 * 1000, 1000 * 2 ** Math.max(0, attempts - 1));
}

export function canRetryLineNotification(
  notification: Pick<LineNotification, 'status' | 'attempts'>,
  maxAttempts = 5,
): boolean {
  return (
    notification.status === 'failed' && notification.attempts < maxAttempts
  );
}

// LINE本文に表示するリンクは同一アプリの既知の画面だけを指し、外部サイトへの転送を許可しない。
export function buildLineDeepLink(
  publicAppUrl: string,
  sourceType: LineNotificationSource,
  sourceId: string,
): string {
  const base = new URL(publicAppUrl);
  if (base.protocol !== 'https:' && base.hostname !== 'localhost')
    throw new Error(
      'LINE通知のリンクにはHTTPSまたはlocalのlocalhostを指定します。',
    );
  if (!/^[A-Za-z0-9._~-]+$/.test(sourceId))
    throw new Error('通知元IDの形式が不正です。');
  const path = sourceType === 'bulletin' ? 'bulletins' : 'events';
  return new URL(`/${path}/${encodeURIComponent(sourceId)}`, base).toString();
}

// LIFF起動時も遷移先をsourceの画面に限定し、任意URLをliff.stateへ埋め込ませない。
export function buildLineLiffLink(
  liffId: string,
  sourceType: LineNotificationSource,
  sourceId: string,
): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(liffId.trim()))
    throw new Error('LIFF IDの形式が不正です。');
  const statePath = new URL(
    buildLineDeepLink('https://cocolo.invalid', sourceType, sourceId),
  ).pathname;
  const url = new URL(`https://liff.line.me/${liffId.trim()}`);
  url.searchParams.set('liff.state', statePath);
  return url.toString();
}
