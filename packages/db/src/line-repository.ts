import {
  createUuidV7,
  type LineConnection,
  LineConnectionConflictError,
  type LineNotification,
  LineNotificationStateError,
  type LineWebhookReceipt,
} from '@cocolo/domain/line';

export type LineActor = {
  tenantId: string;
  userId: string;
};

export type EnqueueLineNotificationInput = Omit<
  LineNotification,
  | 'id'
  | 'status'
  | 'attempts'
  | 'nextRetryAt'
  | 'providerMessageId'
  | 'lastError'
  | 'createdAt'
  | 'sentAt'
>;

export type LineNotificationRepository = {
  getConnection: (tenantId: string) => Promise<LineConnection | null>;
  connect: (input: {
    tenantId: string;
    groupId: string;
    now: Date;
  }) => Promise<LineConnection>;
  disconnect: (input: { tenantId: string; now: Date }) => Promise<void>;
  findTenantByConnectedGroupId: (
    groupId: string,
  ) => Promise<{ tenantId: string; groupId: string } | null>;
  recordWebhookReceipt: (receipt: LineWebhookReceipt) => Promise<boolean>;
  enqueue: (
    input: EnqueueLineNotificationInput,
    now: Date,
  ) => Promise<LineNotification | null>;
  getNotification: (
    input: LineActor & { notificationId: string },
  ) => Promise<LineNotification | null>;
  requeue: (input: {
    tenantId: string;
    notificationId: string;
    now: Date;
  }) => Promise<LineNotification>;
  claimDue: (input: {
    now: Date;
    maxAttempts?: number;
  }) => Promise<{ notification: LineNotification; groupId: string } | null>;
  markSent: (input: {
    tenantId: string;
    notificationId: string;
    providerMessageId: string;
    now: Date;
  }) => Promise<LineNotification>;
  markFailed: (input: {
    tenantId: string;
    notificationId: string;
    error: string;
    nextRetryAt: Date | null;
    now: Date;
  }) => Promise<LineNotification>;
};

function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clone(item)]),
    ) as T;
  }
  return value;
}

// local/testで外部DBなしにRLS境界と状態遷移を再現する。tenantId付きキーを全操作で要求する。
export function createInMemoryLineRepository(
  options: { idFactory?: () => string } = {},
): LineNotificationRepository {
  const connections = new Map<string, LineConnection>();
  const notifications = new Map<string, LineNotification>();
  const webhookReceipts = new Set<string>();
  const idFactory = options.idFactory ?? createUuidV7;

  return {
    async getConnection(tenantId) {
      return clone(connections.get(tenantId) ?? null);
    },
    async connect({ tenantId, groupId, now }) {
      for (const connection of connections.values()) {
        if (
          connection.status === 'connected' &&
          connection.groupId === groupId &&
          connection.tenantId !== tenantId
        )
          throw new LineConnectionConflictError();
      }
      const connection: LineConnection = {
        tenantId,
        groupId,
        status: 'connected',
        connectedAt: new Date(now),
        updatedAt: new Date(now),
      };
      connections.set(tenantId, connection);
      return clone(connection);
    },
    async disconnect({ tenantId, now }) {
      const connection = connections.get(tenantId);
      if (!connection) return;
      connection.status = 'disconnected';
      connection.groupId = null;
      connection.updatedAt = new Date(now);
    },
    async findTenantByConnectedGroupId(groupId) {
      const matches = [...connections.values()].filter(
        (connection) =>
          connection.status === 'connected' && connection.groupId === groupId,
      );
      if (matches.length !== 1 || !matches[0]?.groupId) return null;
      return { tenantId: matches[0].tenantId, groupId: matches[0].groupId };
    },
    async recordWebhookReceipt(receipt) {
      const connection = connections.get(receipt.tenantId);
      if (
        connection?.status !== 'connected' ||
        connection.groupId !== receipt.groupId
      )
        return false;
      const key = `${receipt.groupId}:${receipt.webhookEventId}`;
      if (webhookReceipts.has(key)) return false;
      webhookReceipts.add(key);
      return true;
    },
    async enqueue(input, now) {
      const notification: LineNotification = {
        ...clone(input),
        id: idFactory(),
        status: 'pending',
        attempts: 0,
        nextRetryAt: null,
        providerMessageId: null,
        lastError: null,
        createdAt: new Date(now),
        sentAt: null,
      };
      notifications.set(notification.id, notification);
      return clone(notification);
    },
    async getNotification({ tenantId, notificationId }) {
      const notification = notifications.get(notificationId);
      if (!notification || notification.tenantId !== tenantId) return null;
      return clone(notification);
    },
    async requeue({ tenantId, notificationId, now }) {
      const notification = notifications.get(notificationId);
      if (!notification || notification.tenantId !== tenantId)
        throw new LineNotificationStateError('通知が見つかりません。');
      if (notification.status !== 'failed')
        throw new LineNotificationStateError(
          '失敗状態の通知だけを再試行できます。',
        );
      notification.status = 'pending';
      notification.nextRetryAt = new Date(now);
      notification.lastError = null;
      return clone(notification);
    },
    async claimDue({ now, maxAttempts = 5 }) {
      const due = [...notifications.values()]
        .filter(
          (notification) =>
            (notification.status === 'pending' ||
              notification.status === 'failed') &&
            notification.attempts < maxAttempts &&
            (notification.nextRetryAt === null ||
              notification.nextRetryAt <= now),
        )
        .sort(
          (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
        );
      for (const notification of due) {
        const connection = connections.get(notification.tenantId);
        if (
          connection?.status !== 'connected' ||
          connection.groupId !== notification.groupId
        )
          continue;
        notification.status = 'sending';
        notification.attempts += 1;
        return {
          notification: clone(notification),
          groupId: notification.groupId,
        };
      }
      return null;
    },
    async markSent({ tenantId, notificationId, providerMessageId, now }) {
      const notification = notifications.get(notificationId);
      if (
        !notification ||
        notification.tenantId !== tenantId ||
        notification.status !== 'sending'
      )
        throw new LineNotificationStateError(
          '送信中の通知だけを送信済みにできます。',
        );
      notification.status = 'sent';
      notification.providerMessageId = providerMessageId;
      notification.sentAt = new Date(now);
      notification.nextRetryAt = null;
      return clone(notification);
    },
    async markFailed({ tenantId, notificationId, error, nextRetryAt, now }) {
      const notification = notifications.get(notificationId);
      if (
        !notification ||
        notification.tenantId !== tenantId ||
        notification.status !== 'sending'
      )
        throw new LineNotificationStateError(
          '送信中の通知だけを失敗へ変更できます。',
        );
      notification.status = 'failed';
      notification.lastError = error.slice(0, 500);
      notification.nextRetryAt = nextRetryAt ? new Date(nextRetryAt) : null;
      notification.sentAt = null;
      notification.createdAt = new Date(notification.createdAt);
      void now;
      return clone(notification);
    },
  };
}

export type SqlQueryResult<Row> = { rows: Row[] };
export type LineSqlClient = {
  query: <Row>(
    sql: string,
    values: readonly unknown[],
  ) => Promise<SqlQueryResult<Row>>;
};

type ConnectionRow = {
  tenant_id: string;
  group_id: string | null;
  status: 'connected' | 'disconnected';
  connected_at: Date | null;
  updated_at: Date;
};

type NotificationRow = {
  id: string;
  tenant_id: string;
  group_id: string;
  created_by_user_id: string;
  source_type: LineNotification['sourceType'];
  source_id: string;
  title: string;
  body: string;
  deep_link: string;
  status: LineNotification['status'];
  attempts: number;
  next_retry_at: Date | null;
  provider_message_id: string | null;
  last_error: string | null;
  created_at: Date;
  sent_at: Date | null;
};

function toConnection(row: ConnectionRow): LineConnection {
  return {
    tenantId: row.tenant_id,
    groupId: row.group_id,
    status: row.status,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
  };
}

function toNotification(row: NotificationRow): LineNotification {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    groupId: row.group_id,
    createdByUserId: row.created_by_user_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    title: row.title,
    body: row.body,
    deepLink: row.deep_link,
    status: row.status,
    attempts: row.attempts,
    nextRetryAt: row.next_retry_at,
    providerMessageId: row.provider_message_id,
    lastError: row.last_error,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  };
}

// productionでは将来のLINE専用migrationが提供する表を、tenant条件付きSQLだけで操作する。
export function createSqlLineRepository(
  client: LineSqlClient,
): LineNotificationRepository {
  return {
    async getConnection(tenantId) {
      const result = await client.query<ConnectionRow>(
        `SELECT tenant_id, group_id, status, connected_at, updated_at
           FROM line_connections
          WHERE tenant_id = $1
          LIMIT 1`,
        [tenantId],
      );
      return result.rows[0] ? toConnection(result.rows[0]) : null;
    },
    async connect({ tenantId, groupId, now }) {
      const result = await client.query<ConnectionRow>(
        `INSERT INTO line_connections
           (tenant_id, group_id, status, connected_at, updated_at)
         SELECT $1, $2, 'connected', $3, $3
          WHERE NOT EXISTS (
            SELECT 1 FROM line_connections
             WHERE group_id = $2 AND status = 'connected' AND tenant_id <> $1
          )
         ON CONFLICT (tenant_id) DO UPDATE
           SET group_id = EXCLUDED.group_id,
               status = 'connected',
               connected_at = EXCLUDED.connected_at,
               updated_at = EXCLUDED.updated_at
         RETURNING tenant_id, group_id, status, connected_at, updated_at`,
        [tenantId, groupId, now],
      );
      if (!result.rows[0]) throw new LineConnectionConflictError();
      return toConnection(result.rows[0]);
    },
    async disconnect({ tenantId, now }) {
      await client.query(
        `UPDATE line_connections
            SET status = 'disconnected', group_id = NULL, updated_at = $2
          WHERE tenant_id = $1`,
        [tenantId, now],
      );
    },
    async findTenantByConnectedGroupId(groupId) {
      const result = await client.query<{
        tenant_id: string;
        group_id: string;
      }>(
        `SELECT tenant_id, group_id
           FROM line_connections
          WHERE group_id = $1 AND status = 'connected'
          LIMIT 2`,
        [groupId],
      );
      if (result.rows.length !== 1) return null;
      const row = result.rows[0];
      return row ? { tenantId: row.tenant_id, groupId: row.group_id } : null;
    },
    async recordWebhookReceipt(receipt) {
      const result = await client.query(
        `INSERT INTO line_webhook_receipts
           (tenant_id, group_id, webhook_event_id, received_at)
         SELECT $1, $2, $3, $4
          WHERE EXISTS (
            SELECT 1 FROM line_connections
             WHERE tenant_id = $1 AND group_id = $2 AND status = 'connected'
          )
         ON CONFLICT (group_id, webhook_event_id) DO NOTHING
         RETURNING webhook_event_id`,
        [
          receipt.tenantId,
          receipt.groupId,
          receipt.webhookEventId,
          receipt.receivedAt,
        ],
      );
      return result.rows.length === 1;
    },
    async enqueue(input, now) {
      const result = await client.query<NotificationRow>(
        `INSERT INTO line_notification_queue
           (tenant_id, group_id, created_by_user_id, source_type, source_id,
            title, body, deep_link, status, attempts, created_at)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, 'pending', 0, $9
          WHERE EXISTS (
            SELECT 1 FROM line_connections
             WHERE tenant_id = $1 AND group_id = $2 AND status = 'connected'
          )
         RETURNING id, tenant_id, group_id, created_by_user_id, source_type,
                   source_id, title, body, deep_link, status, attempts,
                   next_retry_at,
                   provider_message_id, last_error, created_at, sent_at`,
        [
          input.tenantId,
          input.groupId,
          input.createdByUserId,
          input.sourceType,
          input.sourceId,
          input.title,
          input.body,
          input.deepLink,
          now,
        ],
      );
      const row = result.rows[0];
      return row ? toNotification(row) : null;
    },
    async getNotification({ tenantId, notificationId }) {
      const result = await client.query<NotificationRow>(
        `SELECT id, tenant_id, group_id, created_by_user_id, source_type, source_id, title, body,
                deep_link, status, attempts, next_retry_at,
                provider_message_id, last_error, created_at, sent_at
           FROM line_notification_queue
          WHERE tenant_id = $1 AND id = $2
          LIMIT 1`,
        [tenantId, notificationId],
      );
      return result.rows[0] ? toNotification(result.rows[0]) : null;
    },
    async requeue({ tenantId, notificationId, now }) {
      const result = await client.query<NotificationRow>(
        `UPDATE line_notification_queue
            SET status = 'pending', next_retry_at = $3, last_error = NULL
          WHERE tenant_id = $1 AND id = $2 AND status = 'failed'
          RETURNING id, tenant_id, group_id, created_by_user_id, source_type, source_id, title, body,
                    deep_link, status, attempts, next_retry_at,
                    provider_message_id, last_error, created_at, sent_at`,
        [tenantId, notificationId, now],
      );
      const row = result.rows[0];
      if (!row)
        throw new LineNotificationStateError('通知を再試行できません。');
      return toNotification(row);
    },
    async claimDue({ now, maxAttempts = 5 }) {
      const result = await client.query<NotificationRow>(
        `WITH candidate AS (
          SELECT q.id
            FROM line_notification_queue q
            JOIN line_connections c ON c.tenant_id = q.tenant_id
           WHERE q.status IN ('pending', 'failed')
             AND q.attempts < $2
             AND (q.next_retry_at IS NULL OR q.next_retry_at <= $1)
             AND c.status = 'connected' AND c.group_id = q.group_id
           ORDER BY q.created_at, q.id
           FOR UPDATE OF q SKIP LOCKED
           LIMIT 1
        )
        UPDATE line_notification_queue q
           SET status = 'sending', attempts = q.attempts + 1
         FROM candidate, line_connections c
         WHERE q.id = candidate.id AND c.tenant_id = q.tenant_id
           AND c.status = 'connected' AND c.group_id = q.group_id
         RETURNING q.id, q.tenant_id, q.group_id, q.created_by_user_id,
                   q.source_type,
                   q.source_id, q.title,
                   q.body, q.deep_link, q.status, q.attempts,
                   q.next_retry_at, q.provider_message_id, q.last_error,
                   q.created_at, q.sent_at`,
        [now, maxAttempts],
      );
      const row = result.rows[0];
      return row?.group_id
        ? { notification: toNotification(row), groupId: row.group_id }
        : null;
    },
    async markSent({ tenantId, notificationId, providerMessageId, now }) {
      const result = await client.query<NotificationRow>(
        `UPDATE line_notification_queue
            SET status = 'sent', provider_message_id = $3,
                sent_at = $4, next_retry_at = NULL
          WHERE tenant_id = $1 AND id = $2 AND status = 'sending'
          RETURNING id, tenant_id, group_id, created_by_user_id, source_type, source_id, title, body,
                    deep_link, status, attempts, next_retry_at,
                    provider_message_id, last_error, created_at, sent_at`,
        [tenantId, notificationId, providerMessageId, now],
      );
      const row = result.rows[0];
      if (!row)
        throw new LineNotificationStateError('通知を送信済みにできません。');
      return toNotification(row);
    },
    async markFailed({ tenantId, notificationId, error, nextRetryAt, now }) {
      const result = await client.query<NotificationRow>(
        `UPDATE line_notification_queue
            SET status = 'failed', last_error = $3,
                next_retry_at = $4
          WHERE tenant_id = $1 AND id = $2 AND status = 'sending'
          RETURNING id, tenant_id, group_id, created_by_user_id, source_type, source_id, title, body,
                    deep_link, status, attempts, next_retry_at,
                    provider_message_id, last_error, created_at, sent_at`,
        [tenantId, notificationId, error.slice(0, 500), nextRetryAt, now],
      );
      const row = result.rows[0];
      if (!row)
        throw new LineNotificationStateError('通知を失敗へ変更できません。');
      return toNotification(row);
    },
  };
}
