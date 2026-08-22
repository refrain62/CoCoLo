import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  createMemberRepositories,
  createPrismaClient,
  enqueueLineDelivery,
} from '@cocolo/db';
import { createApp } from '../../dist/app.js';
import {
  createLineDeliveryProcessor,
  createPostgresLineDeliveryRepository,
  type LineDeliveryDatabase,
} from '../../dist/line-delivery-scheduler.js';

const TENANT_B = '00000000-0000-7000-8000-000000000002';
const ACTOR = 'owner-a';
const RACE_ACTOR = 'owner-b';

assert.ok(process.env.DATABASE_URL, 'DATABASE_URLが必要です');
assert.ok(
  process.env.LINE_DELIVERY_WORKER_DATABASE_URL,
  'LINE_DELIVERY_WORKER_DATABASE_URLが必要です',
);
assert.ok(process.env.DIRECT_URL, 'DIRECT_URLが必要です');

const app = createPrismaClient(process.env.DATABASE_URL);
const worker = createPrismaClient(
  process.env.LINE_DELIVERY_WORKER_DATABASE_URL,
);
const owner = createPrismaClient(process.env.DIRECT_URL);
const apiRepositories = createMemberRepositories(app);
const api = createApp({
  verifyToken: async (token) => {
    if (token !== 'integration-owner-token') throw new Error('invalid token');
    return {
      userId: ACTOR,
      issuer: 'integration',
      audience: 'integration',
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    };
  },
  ...apiRepositories,
});

function workerDatabase(): LineDeliveryDatabase {
  return {
    transaction: (work) =>
      worker.$transaction(async (tx) =>
        work({
          queryRaw: <Row>(
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => tx.$queryRaw<Row>(strings, ...values),
        }),
      ),
  };
}

async function requestProductionApi(input: {
  sourceId: string;
  idempotencyKey: string;
  title?: string;
}) {
  return api.request('/api/v1/notifications/line', {
    method: 'POST',
    headers: {
      authorization: 'Bearer integration-owner-token',
      'content-type': 'application/json',
      'idempotency-key': input.idempotencyKey,
    },
    body: JSON.stringify({
      sourceId: input.sourceId,
      destination: 'Uintegration',
      title: input.title ?? '統合テスト通知',
      body: '統合テスト本文',
      deepLink: 'https://app.example.test/integration',
    }),
  });
}

async function publishViaProductionApi(input: {
  sourceId: string;
  idempotencyKey: string;
  title?: string;
}) {
  const response = await requestProductionApi(input);
  assert.equal(response.status, 202);
  const result = (await response.json()) as {
    data: { notificationId: string; status: string };
  };
  assert.equal(result.data.status, 'pending');
  return result.data.notificationId;
}

test('同一tenantで別sourceがIdempotency-Keyを再利用しても500ではなく409になる', async () => {
  const idempotencyKey = `cross-source-${randomUUID()}`;
  const firstId = await publishViaProductionApi({
    sourceId: `cross-source-a-${randomUUID()}`,
    idempotencyKey,
  });
  const conflict = await requestProductionApi({
    sourceId: `cross-source-b-${randomUUID()}`,
    idempotencyKey,
  });
  assert.equal(conflict.status, 409);
  const rows = await owner.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count
      FROM line_delivery_outbox
     WHERE tenant_id = ${TENANT_B}::uuid
       AND idempotency_key = ${idempotencyKey}
  `;
  assert.deepEqual(rows, [{ count: 1n }]);
  await owner.$executeRaw`
    DELETE FROM audit_logs WHERE resource_id = ${firstId}::uuid
  `;
  await owner.$executeRaw`
    DELETE FROM line_delivery_outbox WHERE id = ${firstId}::uuid
  `;
});

test('業務transactionのenqueueからworker claim・送信・sent確定まで実DBで完了する', async () => {
  const sourceId = `integration-${randomUUID()}`;
  const idempotencyKey = `integration-${randomUUID()}`;
  const notificationId = await publishViaProductionApi({
    sourceId,
    idempotencyKey,
  });

  const retryNotificationId = await publishViaProductionApi({
    sourceId,
    idempotencyKey,
  });
  assert.equal(retryNotificationId, notificationId);
  const sentKeys: string[] = [];
  const retryKeys: string[] = [];
  const repository = createPostgresLineDeliveryRepository(workerDatabase());
  const processor = createLineDeliveryProcessor({
    repository,
    transport: {
      send: async ({ idempotencyKey: key, retryKey }) => {
        sentKeys.push(key);
        retryKeys.push(retryKey);
        return { providerMessageId: `provider-${randomUUID()}` };
      },
    },
    maxAttempts: 5,
    leaseMs: 5000,
    sendTimeoutMs: 100,
    retryBaseDelayMs: 1000,
  });
  assert.equal(
    await processor.processOne({ signal: new AbortController().signal }),
    'sent',
  );
  assert.deepEqual(sentKeys, [idempotencyKey]);

  const rows = await owner.$queryRaw<
    Array<{ status: string; attempt: number; provider_retry_key: string }>
  >`
    SELECT status, attempt, provider_retry_key
      FROM line_delivery_outbox
     WHERE id = ${notificationId}::uuid
  `;
  assert.deepEqual(rows, [
    {
      status: 'sent',
      attempt: 1,
      provider_retry_key: notificationId,
    },
  ]);
  assert.deepEqual(retryKeys, [notificationId]);
  const auditRows = await owner.$queryRaw<Array<{ action: string }>>`
    SELECT action
      FROM audit_logs
     WHERE resource_id = ${notificationId}::uuid
       AND action = 'line_delivery.requested'
  `;
  assert.equal(auditRows.length, 2);
  await owner.$executeRaw`
    DELETE FROM audit_logs WHERE resource_id = ${notificationId}::uuid
  `;
  await owner.$executeRaw`
    DELETE FROM line_delivery_outbox WHERE id = ${notificationId}::uuid
  `;
});

test('retry・unknown・lease切れは同じprovider retry keyで重複送信を抑止する', async () => {
  const retryId = await publishViaProductionApi({
    sourceId: `retry-${randomUUID()}`,
    idempotencyKey: `retry-${randomUUID()}`,
    title: '再試行統合テスト',
  });
  const unknownId = await publishViaProductionApi({
    sourceId: `unknown-${randomUUID()}`,
    idempotencyKey: `unknown-${randomUUID()}`,
    title: '照合待ち統合テスト',
  });
  const leaseId = await publishViaProductionApi({
    sourceId: `lease-${randomUUID()}`,
    idempotencyKey: `lease-${randomUUID()}`,
    title: 'lease切れ統合テスト',
  });
  const providerCalls: Array<{ notificationId: string; retryKey: string }> = [];
  const providerDelivered = new Set<string>();
  let retryAttempts = 0;
  let leaseAttempts = 0;
  const repository = createPostgresLineDeliveryRepository(workerDatabase());
  const processor = createLineDeliveryProcessor({
    repository,
    transport: {
      send: async ({ notification, retryKey, signal }) => {
        providerCalls.push({
          notificationId: notification.notificationId,
          retryKey,
        });
        providerDelivered.add(retryKey);
        if (notification.notificationId === retryId && retryAttempts++ === 0)
          throw new Error('provider応答を失ったため再試行する');
        if (notification.notificationId === unknownId) {
          await new Promise<void>((resolve) => {
            if (signal.aborted) return resolve();
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          return { providerMessageId: `provider-${retryKey}` };
        }
        if (notification.notificationId === leaseId && leaseAttempts++ === 0)
          await owner.$executeRaw`
            UPDATE line_delivery_outbox
               SET lease_expires_at = clock_timestamp() - interval '1 second'
             WHERE id = ${leaseId}::uuid
          `;
        return { providerMessageId: `provider-${retryKey}` };
      },
    },
    maxAttempts: 5,
    leaseMs: 5000,
    sendTimeoutMs: 20,
    retryBaseDelayMs: 1,
  });

  assert.equal(
    await processor.processOne({ signal: new AbortController().signal }),
    'failed',
  );
  assert.equal(
    await processor.processOne({ signal: new AbortController().signal }),
    'unknown',
  );
  assert.equal(
    await processor.processOne({ signal: new AbortController().signal }),
    'stale',
  );
  assert.equal(
    await processor.processOne({ signal: new AbortController().signal }),
    'sent',
  );
  await owner.$executeRaw`
    UPDATE line_delivery_outbox
       SET next_retry_at = created_at
     WHERE id = ${retryId}::uuid
  `;
  assert.equal(
    await processor.processOne({ signal: new AbortController().signal }),
    'sent',
  );

  const callsByNotification = (notificationId: string) =>
    providerCalls.filter((call) => call.notificationId === notificationId);
  const retryCalls = callsByNotification(retryId);
  const unknownCalls = callsByNotification(unknownId);
  const leaseCalls = callsByNotification(leaseId);
  assert.equal(retryCalls.length, 2);
  assert.equal(new Set(retryCalls.map((call) => call.retryKey)).size, 1);
  assert.equal(unknownCalls.length, 1);
  assert.equal(leaseCalls.length, 2);
  assert.equal(new Set(leaseCalls.map((call) => call.retryKey)).size, 1);
  assert.equal(providerDelivered.size, 3);

  const rows = await owner.$queryRaw<
    Array<{ id: string; status: string; attempt: number }>
  >`
    SELECT id, status, attempt
      FROM line_delivery_outbox
     WHERE id IN (${retryId}::uuid, ${unknownId}::uuid, ${leaseId}::uuid)
     ORDER BY id
  `;
  assert.deepEqual(
    rows.sort((left, right) => left.id.localeCompare(right.id)),
    [
      { id: retryId, status: 'sent', attempt: 2 },
      { id: unknownId, status: 'unknown', attempt: 1 },
      { id: leaseId, status: 'sent', attempt: 2 },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
  for (const notificationId of [retryId, unknownId, leaseId]) {
    await owner.$executeRaw`
      DELETE FROM audit_logs WHERE resource_id = ${notificationId}::uuid
    `;
    await owner.$executeRaw`
      DELETE FROM line_delivery_outbox WHERE id = ${notificationId}::uuid
    `;
  }
});

test('unknown確定は古いtokenまたは期限切れleaseでは状態を変更しない', async () => {
  const notificationId = await publishViaProductionApi({
    sourceId: `unknown-lease-guard-${randomUUID()}`,
    idempotencyKey: `unknown-lease-guard-${randomUUID()}`,
    title: 'unknown lease guard統合テスト',
  });
  const repository = createPostgresLineDeliveryRepository(workerDatabase());
  const firstClaim = await repository.claimDue({
    maxAttempts: 5,
    leaseMs: 5000,
  });
  assert.ok(firstClaim);
  assert.equal(firstClaim.notificationId, notificationId);

  const staleTokenResult = await repository.markUnknown({
    tenantId: firstClaim.tenantId,
    notificationId,
    attemptToken: randomUUID(),
    errorCode: 'timeout',
  });
  assert.equal(staleTokenResult, 'stale');

  await owner.$executeRaw`
    UPDATE line_delivery_outbox
       SET lease_expires_at = clock_timestamp() - interval '1 second'
     WHERE id = ${notificationId}::uuid
  `;
  const expiredLeaseResult = await repository.markUnknown({
    tenantId: firstClaim.tenantId,
    notificationId,
    attemptToken: firstClaim.attemptToken,
    errorCode: 'timeout',
  });
  assert.equal(expiredLeaseResult, 'stale');

  const rows = await owner.$queryRaw<
    Array<{ status: string; last_error_code: string | null }>
  >`
    SELECT status, last_error_code
      FROM line_delivery_outbox
     WHERE id = ${notificationId}::uuid
  `;
  assert.deepEqual(rows, [{ status: 'sending', last_error_code: null }]);
  const unknownAuditRows = await owner.$queryRaw<Array<{ action: string }>>`
    SELECT action
      FROM audit_logs
     WHERE resource_id = ${notificationId}::uuid
       AND action = 'line_delivery.unknown'
  `;
  assert.deepEqual(unknownAuditRows, []);
  await owner.$executeRaw`
    DELETE FROM audit_logs WHERE resource_id = ${notificationId}::uuid
  `;
  await owner.$executeRaw`
    DELETE FROM line_delivery_outbox WHERE id = ${notificationId}::uuid
  `;
});

test('enqueueはmembership変更とFOR UPDATEで直列化し、停止後の通知登録を拒否する', async () => {
  const hold = owner.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE tenant_memberships
         SET status = 'suspended'
       WHERE tenant_id = ${TENANT_B}::uuid AND user_id = ${RACE_ACTOR}
    `;
    await tx.$queryRaw`SELECT 1 FROM pg_sleep(0.2)`;
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await assert.rejects(
    app.$transaction(async (tx) =>
      enqueueLineDelivery(tx, {
        id: randomUUID(),
        tenantId: TENANT_B,
        actorUserId: RACE_ACTOR,
        role: 'owner',
        sourceType: 'integration',
        sourceId: `membership-race-${randomUUID()}`,
        destination: 'Uintegration',
        title: '競合テスト',
        body: '競合テスト本文',
        deepLink: 'https://app.example.test/integration',
        idempotencyKey: `membership-race-${randomUUID()}`,
      }),
    ),
    /有効な所属情報|登録権限/,
  );
  await hold;
  await owner.$executeRaw`
    UPDATE tenant_memberships
       SET status = 'active'
     WHERE tenant_id = ${TENANT_B}::uuid AND user_id = ${RACE_ACTOR}
  `;
});

test('worker接続は専用role・RLS非bypassでclaim関数だけを利用する', async () => {
  const rows = await worker.$queryRaw<
    Array<{ current_user: string; rolbypassrls: boolean }>
  >`
    SELECT current_user, rolbypassrls
      FROM pg_roles
     WHERE rolname = current_user
  `;
  assert.deepEqual(rows, [
    { current_user: 'line_delivery_worker', rolbypassrls: false },
  ]);
  await assert.rejects(
    worker.$queryRaw`SELECT * FROM line_delivery_outbox LIMIT 1`,
    /permission denied|row-level security/i,
  );
  await assert.rejects(
    app.$queryRaw`SELECT * FROM app_claim_line_delivery_outbox(5::integer, 5000::integer)`,
    /permission denied/i,
  );
});

test.after(async () => {
  await Promise.all([
    app.$disconnect(),
    worker.$disconnect(),
    owner.$disconnect(),
  ]);
});
