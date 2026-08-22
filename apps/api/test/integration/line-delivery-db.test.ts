import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createPrismaClient, enqueueLineDelivery } from '@cocolo/db';
import {
  createLineDeliveryProcessor,
  createPostgresLineDeliveryRepository,
  type LineDeliveryDatabase,
} from '../../dist/line-delivery-scheduler.js';

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const TENANT_B = '00000000-0000-7000-8000-000000000002';
const MEMBER_A = '00000000-0000-7000-8000-000000000201';
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

test('業務transactionのenqueueからworker claim・送信・sent確定まで実DBで完了する', async () => {
  const notificationId = randomUUID();
  const sourceId = `integration-${randomUUID()}`;
  const idempotencyKey = `integration-${randomUUID()}`;
  const input = {
    id: notificationId,
    tenantId: TENANT_A,
    actorUserId: ACTOR,
    role: 'owner' as const,
    sourceType: 'integration',
    sourceId,
    destination: 'Uintegration',
    title: '統合テスト通知',
    body: '統合テスト本文',
    deepLink: 'https://app.example.test/integration',
    idempotencyKey,
  };
  await app.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT set_config('app.tenant_id', ${TENANT_A}, true),
             set_config('app.user_id', ${ACTOR}, true),
             set_config('app.role', 'owner', true)
    `;
    await tx.member.update({
      where: { tenantId_id: { tenantId: TENANT_A, id: MEMBER_A } },
      data: { note: `transaction-${sourceId}` },
    });
    assert.equal(await enqueueLineDelivery(tx, input), notificationId);
  });

  const sentKeys: string[] = [];
  const repository = createPostgresLineDeliveryRepository(workerDatabase());
  const processor = createLineDeliveryProcessor({
    repository,
    transport: {
      send: async ({ idempotencyKey: key }) => {
        sentKeys.push(key);
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
    Array<{ status: string; attempt: number }>
  >`
    SELECT status, attempt FROM line_delivery_outbox WHERE id = ${notificationId}::uuid
  `;
  assert.deepEqual(rows, [{ status: 'sent', attempt: 1 }]);
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
