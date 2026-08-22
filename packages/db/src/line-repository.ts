import { randomUUID } from 'node:crypto';

export type LineRepositoryTargetType = 'group' | 'official_account';
export type LineRepositoryNotificationType =
  | 'schedule'
  | 'deadline'
  | 'announcement';
export type LineRepositoryNotificationState =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'failed';

export type LineBindingRecord = {
  id: string;
  tenantId: string;
  targetType: LineRepositoryTargetType;
  targetId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type LineNotificationRecord = {
  id: string;
  tenantId: string;
  targetType: LineRepositoryTargetType;
  targetId: string;
  eventType: LineRepositoryNotificationType;
  eventId: string;
  dedupeKey: string;
  title: string;
  body: string;
  deepLink: string | null;
  state: LineRepositoryNotificationState;
  attempts: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  providerMessageId: string | null;
  nextAttemptAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export class LineRepositoryConflictError extends Error {
  readonly status = 409;

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LineRepositoryConflictError';
  }
}

export type LineNotificationRepository = {
  getBinding: (tenantId: string) => Promise<LineBindingRecord | null>;
  findBindingByTarget: (input: {
    targetType: LineRepositoryTargetType;
    targetId: string;
  }) => Promise<LineBindingRecord | null>;
  upsertBinding: (input: {
    tenantId: string;
    targetType: LineRepositoryTargetType;
    targetId: string;
    now?: Date;
  }) => Promise<LineBindingRecord>;
  removeBinding: (tenantId: string) => Promise<boolean>;
  enqueueNotification: (input: {
    tenantId: string;
    targetType: LineRepositoryTargetType;
    targetId: string;
    eventType: LineRepositoryNotificationType;
    eventId: string;
    dedupeKey: string;
    title: string;
    body: string;
    deepLink: string | null;
    maxAttempts?: number;
    now?: Date;
  }) => Promise<{ record: LineNotificationRecord; created: boolean }>;
  getNotification: (input: {
    tenantId: string;
    id: string;
  }) => Promise<LineNotificationRecord | null>;
  listNotifications: (input: {
    tenantId: string;
    state?: LineRepositoryNotificationState;
    limit?: number;
  }) => Promise<LineNotificationRecord[]>;
  countNotifications: (tenantId: string) => Promise<{
    queued: number;
    sending: number;
    sent: number;
    failed: number;
  }>;
  claimNotificationForSend: (input: {
    tenantId: string;
    id: string;
    now?: Date;
  }) => Promise<LineNotificationRecord | null>;
  markNotificationSent: (input: {
    tenantId: string;
    id: string;
    providerMessageId: string | null;
    sentAt?: Date;
  }) => Promise<LineNotificationRecord | null>;
  markNotificationFailed: (input: {
    tenantId: string;
    id: string;
    errorCode: string;
    failedAt?: Date;
  }) => Promise<LineNotificationRecord | null>;
  retryNotification: (input: {
    tenantId: string;
    id: string;
    now?: Date;
  }) => Promise<LineNotificationRecord | null>;
  recoverStaleSending: (input: {
    tenantId: string;
    before: Date;
    now?: Date;
  }) => Promise<number>;
  claimWebhookEvent: (input: {
    webhookEventId: string;
    tenantId: string;
    targetType: LineRepositoryTargetType;
    targetId: string;
    receivedAt?: Date;
  }) => Promise<{ duplicate: boolean; conflict: boolean }>;
};

type WebhookEventRecord = {
  webhookEventId: string;
  tenantId: string;
  targetType: LineRepositoryTargetType;
  targetId: string;
  receivedAt: Date;
};

const targetIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,254}$/;
const groupIdPattern = /^C[A-Za-z0-9_-]{2,254}$/;

function cloneDate(value: Date | null): Date | null {
  return value ? new Date(value.getTime()) : null;
}

function cloneBinding(value: LineBindingRecord): LineBindingRecord {
  return {
    ...value,
    createdAt: new Date(value.createdAt.getTime()),
    updatedAt: new Date(value.updatedAt.getTime()),
  };
}

function cloneNotification(
  value: LineNotificationRecord,
): LineNotificationRecord {
  return {
    ...value,
    nextAttemptAt: cloneDate(value.nextAttemptAt),
    sentAt: cloneDate(value.sentAt),
    createdAt: new Date(value.createdAt.getTime()),
    updatedAt: new Date(value.updatedAt.getTime()),
  };
}

function normalizeTarget(
  targetType: LineRepositoryTargetType,
  targetId: string,
): string {
  const normalized = targetId.trim();
  if (!targetIdPattern.test(normalized))
    throw new LineRepositoryConflictError(
      'LINE_TARGET_INVALID',
      'LINE送信先IDが不正です。',
    );
  if (targetType === 'group' && !groupIdPattern.test(normalized))
    throw new LineRepositoryConflictError(
      'LINE_GROUP_ID_INVALID',
      'LINEグループIDが不正です。',
    );
  return normalized;
}

function targetKey(targetType: LineRepositoryTargetType, targetId: string) {
  return `${targetType}:${targetId}`;
}

function retryAt(
  now: Date,
  attempts: number,
  maxAttempts: number,
): Date | null {
  if (attempts >= maxAttempts) return null;
  const delay = Math.min(5 * 60_000, 2 ** Math.max(0, attempts - 1) * 30_000);
  return new Date(now.getTime() + delay);
}

// 共通migrationを変更できないPhaseでは、同じrepository契約をlocal fakeとして実装する。
// 本番接続時はこのportをtenant条件・一意制約・transactionを持つ永続実装へ差し替える。
export function createLineNotificationRepository(
  options: { now?: () => Date } = {},
): LineNotificationRepository {
  const getNow = options.now ?? (() => new Date());
  const bindingsByTenant = new Map<string, LineBindingRecord>();
  const tenantByTarget = new Map<string, string>();
  const notificationsById = new Map<string, LineNotificationRecord>();
  const notificationByDedupe = new Map<string, string>();
  const webhookEvents = new Map<string, WebhookEventRecord>();

  return {
    async getBinding(tenantId) {
      const binding = bindingsByTenant.get(tenantId);
      return binding ? cloneBinding(binding) : null;
    },

    async findBindingByTarget(input) {
      const normalized = normalizeTarget(input.targetType, input.targetId);
      const tenantId = tenantByTarget.get(
        targetKey(input.targetType, normalized),
      );
      const binding = tenantId ? bindingsByTenant.get(tenantId) : undefined;
      return binding ? cloneBinding(binding) : null;
    },

    async upsertBinding(input) {
      if (!input.tenantId.trim())
        throw new LineRepositoryConflictError(
          'LINE_TENANT_INVALID',
          'チームIDが不正です。',
        );
      const targetId = normalizeTarget(input.targetType, input.targetId);
      const key = targetKey(input.targetType, targetId);
      const otherTenantId = tenantByTarget.get(key);
      if (otherTenantId && otherTenantId !== input.tenantId)
        throw new LineRepositoryConflictError(
          'LINE_TARGET_ALREADY_BOUND',
          'LINE送信先は別のチームに紐付いています。',
        );

      const now = input.now ?? getNow();
      const current = bindingsByTenant.get(input.tenantId);
      if (current && current.targetId !== targetId)
        tenantByTarget.delete(targetKey(current.targetType, current.targetId));
      const binding: LineBindingRecord = current
        ? {
            ...current,
            targetType: input.targetType,
            targetId,
            updatedAt: new Date(now.getTime()),
          }
        : {
            id: randomUUID(),
            tenantId: input.tenantId,
            targetType: input.targetType,
            targetId,
            createdAt: new Date(now.getTime()),
            updatedAt: new Date(now.getTime()),
          };
      bindingsByTenant.set(input.tenantId, binding);
      tenantByTarget.set(key, input.tenantId);
      return cloneBinding(binding);
    },

    async removeBinding(tenantId) {
      const current = bindingsByTenant.get(tenantId);
      if (!current) return false;
      bindingsByTenant.delete(tenantId);
      tenantByTarget.delete(targetKey(current.targetType, current.targetId));
      return true;
    },

    async enqueueNotification(input) {
      const existingId = notificationByDedupe.get(input.dedupeKey);
      if (existingId) {
        const existing = notificationsById.get(existingId);
        if (existing)
          return { record: cloneNotification(existing), created: false };
      }
      const now = input.now ?? getNow();
      const record: LineNotificationRecord = {
        id: randomUUID(),
        tenantId: input.tenantId,
        targetType: input.targetType,
        targetId: input.targetId,
        eventType: input.eventType,
        eventId: input.eventId,
        dedupeKey: input.dedupeKey,
        title: input.title,
        body: input.body,
        deepLink: input.deepLink,
        state: 'queued',
        attempts: 0,
        maxAttempts: Math.min(10, Math.max(1, input.maxAttempts ?? 3)),
        lastErrorCode: null,
        providerMessageId: null,
        nextAttemptAt: null,
        sentAt: null,
        createdAt: new Date(now.getTime()),
        updatedAt: new Date(now.getTime()),
      };
      notificationsById.set(record.id, record);
      notificationByDedupe.set(input.dedupeKey, record.id);
      return { record: cloneNotification(record), created: true };
    },

    async getNotification(input) {
      const record = notificationsById.get(input.id);
      return record?.tenantId === input.tenantId
        ? cloneNotification(record)
        : null;
    },

    async listNotifications(input) {
      return [...notificationsById.values()]
        .filter(
          (record) =>
            record.tenantId === input.tenantId &&
            (!input.state || record.state === input.state),
        )
        .sort(
          (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
        )
        .slice(0, Math.min(100, Math.max(1, input.limit ?? 50)))
        .map(cloneNotification);
    },

    async countNotifications(tenantId) {
      const counts = { queued: 0, sending: 0, sent: 0, failed: 0 };
      for (const record of notificationsById.values())
        if (record.tenantId === tenantId) counts[record.state] += 1;
      return counts;
    },

    async claimNotificationForSend(input) {
      const record = notificationsById.get(input.id);
      if (!record || record.tenantId !== input.tenantId) return null;
      const now = input.now ?? getNow();
      if (
        record.state !== 'queued' ||
        (record.nextAttemptAt && record.nextAttemptAt.getTime() > now.getTime())
      )
        return null;
      record.state = 'sending';
      record.attempts += 1;
      record.updatedAt = new Date(now.getTime());
      return cloneNotification(record);
    },

    async markNotificationSent(input) {
      const record = notificationsById.get(input.id);
      if (!record || record.tenantId !== input.tenantId) return null;
      if (record.state !== 'sending')
        throw new LineRepositoryConflictError(
          'LINE_NOTIFICATION_STATE_CONFLICT',
          'LINE通知の送信状態が競合しました。',
        );
      const sentAt = input.sentAt ?? getNow();
      record.state = 'sent';
      record.providerMessageId = input.providerMessageId;
      record.lastErrorCode = null;
      record.nextAttemptAt = null;
      record.sentAt = new Date(sentAt.getTime());
      record.updatedAt = new Date(sentAt.getTime());
      return cloneNotification(record);
    },

    async markNotificationFailed(input) {
      const record = notificationsById.get(input.id);
      if (!record || record.tenantId !== input.tenantId) return null;
      if (record.state !== 'sending')
        throw new LineRepositoryConflictError(
          'LINE_NOTIFICATION_STATE_CONFLICT',
          'LINE通知の送信状態が競合しました。',
        );
      const failedAt = input.failedAt ?? getNow();
      record.state = 'failed';
      record.lastErrorCode = input.errorCode;
      record.nextAttemptAt = retryAt(
        failedAt,
        record.attempts,
        record.maxAttempts,
      );
      record.updatedAt = new Date(failedAt.getTime());
      return cloneNotification(record);
    },

    async retryNotification(input) {
      const record = notificationsById.get(input.id);
      if (!record || record.tenantId !== input.tenantId) return null;
      if (record.state !== 'failed')
        throw new LineRepositoryConflictError(
          'LINE_NOTIFICATION_NOT_FAILED',
          '失敗状態のLINE通知だけ再送できます。',
        );
      if (record.attempts >= record.maxAttempts)
        throw new LineRepositoryConflictError(
          'LINE_NOTIFICATION_RETRY_EXHAUSTED',
          'LINE通知の再送上限に達しています。',
        );
      const now = input.now ?? getNow();
      record.state = 'queued';
      record.nextAttemptAt = null;
      record.updatedAt = new Date(now.getTime());
      return cloneNotification(record);
    },

    async recoverStaleSending(input) {
      const now = input.now ?? getNow();
      let recovered = 0;
      for (const record of notificationsById.values()) {
        if (
          record.tenantId !== input.tenantId ||
          record.state !== 'sending' ||
          record.updatedAt.getTime() >= input.before.getTime()
        )
          continue;
        if (record.attempts >= record.maxAttempts) {
          record.state = 'failed';
          record.lastErrorCode = 'LINE_SEND_TIMEOUT';
          record.nextAttemptAt = null;
        } else {
          record.state = 'queued';
          record.nextAttemptAt = null;
        }
        record.updatedAt = new Date(now.getTime());
        recovered += 1;
      }
      return recovered;
    },

    async claimWebhookEvent(input) {
      const existing = webhookEvents.get(input.webhookEventId);
      if (existing)
        return {
          duplicate:
            existing.tenantId === input.tenantId &&
            existing.targetType === input.targetType &&
            existing.targetId === input.targetId,
          conflict:
            existing.tenantId !== input.tenantId ||
            existing.targetType !== input.targetType ||
            existing.targetId !== input.targetId,
        };
      webhookEvents.set(input.webhookEventId, {
        webhookEventId: input.webhookEventId,
        tenantId: input.tenantId,
        targetType: input.targetType,
        targetId: input.targetId,
        receivedAt: new Date((input.receivedAt ?? getNow()).getTime()),
      });
      return { duplicate: false, conflict: false };
    },
  };
}
