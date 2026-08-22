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
  role: 'owner' | 'admin' | 'staff' | 'guardian';
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
  getConnection: (
    input: string | Pick<LineActor, 'tenantId' | 'userId' | 'role'>,
  ) => Promise<LineConnection | null>;
  connect: (input: {
    tenantId: string;
    userId?: string;
    role?: LineActor['role'];
    groupId: string;
    now: Date;
  }) => Promise<LineConnection>;
  disconnect: (input: {
    tenantId: string;
    userId?: string;
    role?: LineActor['role'];
    now: Date;
  }) => Promise<void>;
  findTenantByConnectedGroupId: (
    input:
      | string
      | (Pick<LineActor, 'tenantId' | 'userId' | 'role'> & { groupId: string }),
  ) => Promise<{ tenantId: string; groupId: string } | null>;
  recordWebhookReceipt: (
    receipt: LineWebhookReceipt & Partial<Pick<LineActor, 'userId' | 'role'>>,
  ) => Promise<boolean>;
  // 外部Webhookは利用者の所属を持たないため、専用のDB関数で接続先解決と重複排除を一体化する。
  claimWebhookReceipt?: (input: {
    groupId: string;
    webhookEventId: string;
    receivedAt: Date;
  }) => Promise<'accepted' | 'duplicate' | 'ignored'>;
  enqueue: (
    input: EnqueueLineNotificationInput &
      Partial<Pick<LineActor, 'userId' | 'role'>>,
    now: Date,
  ) => Promise<LineNotification | null>;
  getNotification: (
    input: Pick<LineActor, 'tenantId' | 'userId'> &
      Partial<Pick<LineActor, 'role'>> & { notificationId: string },
  ) => Promise<LineNotification | null>;
  requeue: (input: {
    tenantId: string;
    userId?: string;
    role?: LineActor['role'];
    notificationId: string;
    now: Date;
  }) => Promise<LineNotification>;
  claimDue: (input: {
    tenantId?: string;
    userId?: string;
    role?: LineActor['role'];
    now: Date;
    maxAttempts?: number;
  }) => Promise<{ notification: LineNotification; groupId: string } | null>;
  markSent: (input: {
    tenantId: string;
    userId?: string;
    role?: LineActor['role'];
    notificationId: string;
    providerMessageId: string;
    now: Date;
  }) => Promise<LineNotification>;
  markFailed: (input: {
    tenantId: string;
    userId?: string;
    role?: LineActor['role'];
    notificationId: string;
    error: string;
    nextRetryAt: Date | null;
    now: Date;
  }) => Promise<LineNotification>;
};

export type LineDeliveryRepository = Pick<
  LineNotificationRepository,
  'claimDue' | 'markSent' | 'markFailed'
>;

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
    async getConnection(input) {
      const tenantId = typeof input === 'string' ? input : input.tenantId;
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
    async findTenantByConnectedGroupId(input) {
      const groupId = typeof input === 'string' ? input : input.groupId;
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
    async claimWebhookReceipt({ groupId, webhookEventId }) {
      const connection = [...connections.values()].find(
        (candidate) =>
          candidate.status === 'connected' && candidate.groupId === groupId,
      );
      if (!connection) return 'ignored';
      const key = `${groupId}:${webhookEventId}`;
      if (webhookReceipts.has(key)) return 'duplicate';
      webhookReceipts.add(key);
      return 'accepted';
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
export type LineSqlTransactionClient = {
  query: <Row>(
    sql: string,
    values: readonly unknown[],
  ) => Promise<SqlQueryResult<Row>>;
};
export type LineSqlClient = {
  transaction: <T>(
    work: (transaction: LineSqlTransactionClient) => Promise<T>,
  ) => Promise<T>;
};

export type LineSqlOperation =
  | 'getConnection'
  | 'connect'
  | 'disconnect'
  | 'findTenantByConnectedGroupId'
  | 'recordWebhookReceipt'
  | 'enqueue'
  | 'getNotification'
  | 'requeue'
  | 'claimDue'
  | 'markSent'
  | 'markFailed';

export type LineSqlRepositoryOptions = {
  resolveActor?: (
    operation: LineSqlOperation,
    input: unknown,
  ) => LineActor | Promise<LineActor | null> | null;
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

type MembershipRow = { role: LineActor['role']; status: 'active' | string };

function tenantOf(input: unknown): string | null {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object' && 'tenantId' in input) {
    const tenantId = (input as { tenantId?: unknown }).tenantId;
    return typeof tenantId === 'string' ? tenantId : null;
  }
  return null;
}

function hasActor(value: unknown): value is LineActor {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as LineActor).tenantId === 'string' &&
    typeof (value as LineActor).userId === 'string' &&
    typeof (value as LineActor).role === 'string'
  );
}

async function resolveRlsActor(
  operation: LineSqlOperation,
  input: unknown,
  options: LineSqlRepositoryOptions,
): Promise<LineActor> {
  const actor = hasActor(input)
    ? input
    : await options.resolveActor?.(operation, input);
  if (!actor)
    throw new Error('LINE SQL repositoryのRLS actor contextが未設定です。');
  const inputTenantId = tenantOf(input);
  if (inputTenantId && inputTenantId !== actor.tenantId)
    throw new Error('LINE SQL repositoryのRLS tenant contextが不一致です。');
  if (
    input &&
    typeof input === 'object' &&
    'createdByUserId' in input &&
    (input as { createdByUserId?: unknown }).createdByUserId !== actor.userId
  )
    throw new Error('LINE SQL repositoryのRLS user contextが不一致です。');
  return actor;
}

async function setRlsContext(
  client: LineSqlTransactionClient,
  actor: LineActor,
) {
  await client.query(
    `SELECT
       set_config('app.tenant_id', $1, true),
       set_config('app.user_id', $2, true),
       set_config('app.role', $3, true)`,
    [actor.tenantId, actor.userId, actor.role],
  );
}

async function assertActiveMembership(
  client: LineSqlTransactionClient,
  actor: LineActor,
) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `membership:${actor.tenantId}:${actor.userId}`,
  ]);
  const result = await client.query<MembershipRow>(
    `SELECT role, status
       FROM tenant_memberships
      WHERE tenant_id = $1::uuid AND user_id = $2
      LIMIT 1`,
    [actor.tenantId, actor.userId],
  );
  const membership = result.rows[0];
  if (membership?.status !== 'active' || membership.role !== actor.role)
    throw new Error('有効な所属情報が処理中に変更されました。');
}

async function lockLineTenant(
  client: LineSqlTransactionClient,
  tenantId: string,
) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `line:${tenantId}`,
  ]);
}

async function withRlsContext<T>(
  client: LineSqlClient,
  actor: LineActor,
  work: (transaction: LineSqlTransactionClient) => Promise<T>,
) {
  return client.transaction(async (transaction) => {
    await setRlsContext(transaction, actor);
    await assertActiveMembership(transaction, actor);
    return work(transaction);
  });
}

// productionでは全操作をtransaction-local RLS contextで包み、pool接続へtenant状態を残さない。
export function createSqlLineRepository(
  client: LineSqlClient,
  options: LineSqlRepositoryOptions = {},
): LineNotificationRepository {
  return {
    async getConnection(input) {
      const actor = await resolveRlsActor('getConnection', input, options);
      return withRlsContext(client, actor, async (transaction) => {
        const result = await transaction.query<ConnectionRow>(
          `SELECT tenant_id, group_id, status, connected_at, updated_at
             FROM line_connections
            WHERE tenant_id = $1
            LIMIT 1`,
          [actor.tenantId],
        );
        return result.rows[0] ? toConnection(result.rows[0]) : null;
      });
    },
    async connect(input) {
      const actor = await resolveRlsActor('connect', input, options);
      return withRlsContext(client, actor, async (transaction) => {
        await lockLineTenant(transaction, actor.tenantId);
        const result = await transaction.query<ConnectionRow>(
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
          [actor.tenantId, input.groupId, input.now],
        );
        if (!result.rows[0]) throw new LineConnectionConflictError();
        return toConnection(result.rows[0]);
      });
    },
    async disconnect(input) {
      const actor = await resolveRlsActor('disconnect', input, options);
      await withRlsContext(client, actor, async (transaction) => {
        await lockLineTenant(transaction, actor.tenantId);
        await transaction.query(
          `UPDATE line_connections
              SET status = 'disconnected', group_id = NULL, updated_at = $2
            WHERE tenant_id = $1`,
          [actor.tenantId, input.now],
        );
      });
    },
    async findTenantByConnectedGroupId(input) {
      const actor = await resolveRlsActor(
        'findTenantByConnectedGroupId',
        input,
        options,
      );
      const groupId = typeof input === 'string' ? input : input.groupId;
      return withRlsContext(client, actor, async (transaction) => {
        const result = await transaction.query<{
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
      });
    },
    async recordWebhookReceipt(receipt) {
      const actor = await resolveRlsActor(
        'recordWebhookReceipt',
        receipt,
        options,
      );
      return withRlsContext(client, actor, async (transaction) => {
        const result = await transaction.query(
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
            actor.tenantId,
            receipt.groupId,
            receipt.webhookEventId,
            receipt.receivedAt,
          ],
        );
        return result.rows.length === 1;
      });
    },
    async claimWebhookReceipt(input) {
      return client.transaction(async (transaction) => {
        const result = await transaction.query<{
          accepted: boolean;
          duplicate: boolean;
        }>(
          `SELECT accepted, duplicate
             FROM app_claim_line_webhook($1, $2, $3)`,
          [input.groupId, input.webhookEventId, input.receivedAt],
        );
        const row = result.rows[0];
        if (!row) return 'ignored';
        return row.accepted
          ? 'accepted'
          : row.duplicate
            ? 'duplicate'
            : 'ignored';
      });
    },
    async enqueue(input, now) {
      const actor = await resolveRlsActor('enqueue', input, options);
      return withRlsContext(client, actor, async (transaction) => {
        await lockLineTenant(transaction, actor.tenantId);
        const result = await transaction.query<NotificationRow>(
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
            actor.tenantId,
            input.groupId,
            actor.userId,
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
      });
    },
    async getNotification(input) {
      const actor = await resolveRlsActor('getNotification', input, options);
      return withRlsContext(client, actor, async (transaction) => {
        const result = await transaction.query<NotificationRow>(
          `SELECT id, tenant_id, group_id, created_by_user_id, source_type, source_id, title, body,
                  deep_link, status, attempts, next_retry_at,
                  provider_message_id, last_error, created_at, sent_at
             FROM line_notification_queue
            WHERE tenant_id = $1 AND id = $2
            LIMIT 1`,
          [actor.tenantId, input.notificationId],
        );
        return result.rows[0] ? toNotification(result.rows[0]) : null;
      });
    },
    async requeue(input) {
      const actor = await resolveRlsActor('requeue', input, options);
      return withRlsContext(client, actor, async (transaction) => {
        await lockLineTenant(transaction, actor.tenantId);
        const result = await transaction.query<NotificationRow>(
          `UPDATE line_notification_queue
              SET status = 'pending', next_retry_at = $3, last_error = NULL
            WHERE tenant_id = $1 AND id = $2 AND status = 'failed'
            RETURNING id, tenant_id, group_id, created_by_user_id, source_type, source_id, title, body,
                      deep_link, status, attempts, next_retry_at,
                      provider_message_id, last_error, created_at, sent_at`,
          [actor.tenantId, input.notificationId, input.now],
        );
        const row = result.rows[0];
        if (!row)
          throw new LineNotificationStateError('通知を再試行できません。');
        return toNotification(row);
      });
    },
    async claimDue(input) {
      const actor = await resolveRlsActor('claimDue', input, options);
      return withRlsContext(client, actor, async (transaction) => {
        await lockLineTenant(transaction, actor.tenantId);
        const result = await transaction.query<NotificationRow>(
          `WITH candidate AS (
            SELECT q.id
              FROM line_notification_queue q
              JOIN line_connections c ON c.tenant_id = q.tenant_id
             WHERE q.tenant_id = $3
               AND q.status IN ('pending', 'failed')
               AND q.attempts < $2
             AND (q.next_retry_at IS NULL OR q.next_retry_at <= $1)
             AND c.status = 'connected' AND c.group_id = q.group_id
             ORDER BY q.created_at, q.id
             LIMIT 1
             FOR UPDATE OF q SKIP LOCKED
          )
          UPDATE line_notification_queue q
             SET status = 'sending', attempts = q.attempts + 1
           FROM candidate, line_connections c
           WHERE q.id = candidate.id AND c.tenant_id = q.tenant_id
             AND q.tenant_id = $3
             AND c.status = 'connected' AND c.group_id = q.group_id
           RETURNING q.id, q.tenant_id, q.group_id, q.created_by_user_id,
                     q.source_type,
                     q.source_id, q.title,
                     q.body, q.deep_link, q.status, q.attempts,
                     q.next_retry_at, q.provider_message_id, q.last_error,
                     q.created_at, q.sent_at`,
          [input.now, input.maxAttempts ?? 5, actor.tenantId],
        );
        const row = result.rows[0];
        return row?.group_id
          ? { notification: toNotification(row), groupId: row.group_id }
          : null;
      });
    },
    async markSent(input) {
      const actor = await resolveRlsActor('markSent', input, options);
      return withRlsContext(client, actor, async (transaction) => {
        const result = await transaction.query<NotificationRow>(
          `UPDATE line_notification_queue
              SET status = 'sent', provider_message_id = $3,
                  sent_at = $4, next_retry_at = NULL
            WHERE tenant_id = $1 AND id = $2 AND status = 'sending'
            RETURNING id, tenant_id, group_id, created_by_user_id, source_type, source_id, title, body,
                      deep_link, status, attempts, next_retry_at,
                      provider_message_id, last_error, created_at, sent_at`,
          [
            actor.tenantId,
            input.notificationId,
            input.providerMessageId,
            input.now,
          ],
        );
        const row = result.rows[0];
        if (!row)
          throw new LineNotificationStateError('通知を送信済みにできません。');
        return toNotification(row);
      });
    },
    async markFailed(input) {
      const actor = await resolveRlsActor('markFailed', input, options);
      return withRlsContext(client, actor, async (transaction) => {
        const result = await transaction.query<NotificationRow>(
          `UPDATE line_notification_queue
              SET status = 'failed', last_error = $3,
                  next_retry_at = $4
            WHERE tenant_id = $1 AND id = $2 AND status = 'sending'
            RETURNING id, tenant_id, group_id, created_by_user_id, source_type, source_id, title, body,
                      deep_link, status, attempts, next_retry_at,
                      provider_message_id, last_error, created_at, sent_at`,
          [
            actor.tenantId,
            input.notificationId,
            input.error.slice(0, 500),
            input.nextRetryAt,
            input.now,
          ],
        );
        const row = result.rows[0];
        if (!row)
          throw new LineNotificationStateError('通知を失敗へ変更できません。');
        return toNotification(row);
      });
    },
  };
}

// 利用者actorを持たない内部worker専用。SECURITY DEFINER関数以外から全tenantを走査しない。
export function createSqlLineDeliveryRepository(
  client: LineSqlClient,
): LineDeliveryRepository {
  return {
    async claimDue(input) {
      return client.transaction(async (transaction) => {
        const result = await transaction.query<NotificationRow>(
          `SELECT id, tenant_id, group_id, created_by_user_id, source_type, source_id,
                  title, body, deep_link, status, attempts, next_retry_at,
                  provider_message_id, last_error, created_at, sent_at
             FROM app_claim_due_line_notification($1, $2)`,
          [input.now, input.maxAttempts ?? 5],
        );
        const row = result.rows[0];
        return row?.group_id
          ? { notification: toNotification(row), groupId: row.group_id }
          : null;
      });
    },
    async markSent(input) {
      return client.transaction(async (transaction) => {
        const result = await transaction.query<NotificationRow>(
          `SELECT id, tenant_id, group_id, created_by_user_id, source_type, source_id,
                  title, body, deep_link, status, attempts, next_retry_at,
                  provider_message_id, last_error, created_at, sent_at
             FROM app_mark_line_notification_sent($1, $2, $3, $4)`,
          [
            input.tenantId,
            input.notificationId,
            input.providerMessageId,
            input.now,
          ],
        );
        const row = result.rows[0];
        if (!row)
          throw new LineNotificationStateError('通知を送信済みにできません。');
        return toNotification(row);
      });
    },
    async markFailed(input) {
      return client.transaction(async (transaction) => {
        const result = await transaction.query<NotificationRow>(
          `SELECT id, tenant_id, group_id, created_by_user_id, source_type, source_id,
                  title, body, deep_link, status, attempts, next_retry_at,
                  provider_message_id, last_error, created_at, sent_at
             FROM app_mark_line_notification_failed($1, $2, $3, $4, $5)`,
          [
            input.tenantId,
            input.notificationId,
            input.error.slice(0, 500),
            input.nextRetryAt,
            input.now,
          ],
        );
        const row = result.rows[0];
        if (!row)
          throw new LineNotificationStateError('通知を失敗へ変更できません。');
        return toNotification(row);
      });
    },
  };
}

export type LineWebhookTargetType = 'group' | 'official_account';

export type LineWebhookBinding = {
  tenantId: string;
  targetType: LineWebhookTargetType;
  targetId: string;
};

export type LineWebhookRepository = {
  findBindingByTarget: (input: {
    targetType: LineWebhookTargetType;
    targetId: string;
  }) => Promise<LineWebhookBinding | null>;
  claimWebhookEvent: (input: {
    webhookEventId: string;
    tenantId: string;
    targetType: LineWebhookTargetType;
    targetId: string;
    receivedAt?: Date;
  }) => Promise<{ duplicate: boolean; conflict: boolean }>;
};

// Webhook単体テスト用の最小repository。通常の通知repositoryとは責務を分離し、接続先と重複排除だけを再現する。
export function createLineNotificationRepository(): LineWebhookRepository & {
  upsertBinding: (input: {
    tenantId: string;
    targetType: LineWebhookTargetType;
    targetId: string;
  }) => Promise<LineWebhookBinding>;
} {
  const bindings = new Map<string, LineWebhookBinding>();
  const claimedEvents = new Set<string>();
  const bindingKey = (targetType: LineWebhookTargetType, targetId: string) =>
    `${targetType}:${targetId}`;

  return {
    async upsertBinding(input) {
      const binding = {
        tenantId: input.tenantId,
        targetType: input.targetType,
        targetId: input.targetId.trim(),
      } satisfies LineWebhookBinding;
      bindings.set(bindingKey(binding.targetType, binding.targetId), binding);
      return { ...binding };
    },
    async findBindingByTarget(input) {
      const binding = bindings.get(
        bindingKey(input.targetType, input.targetId.trim()),
      );
      return binding ? { ...binding } : null;
    },
    async claimWebhookEvent(input) {
      const key = `${input.targetType}:${input.targetId}:${input.webhookEventId}`;
      if (claimedEvents.has(key)) return { duplicate: true, conflict: false };
      const binding = bindings.get(
        bindingKey(input.targetType, input.targetId),
      );
      if (!binding || binding.tenantId !== input.tenantId)
        return { duplicate: false, conflict: true };
      claimedEvents.add(key);
      return { duplicate: false, conflict: false };
    },
  };
}
