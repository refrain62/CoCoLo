import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { RideOffer } from '@cocolo/domain/ride';
import type { PrismaClient as PrismaClientType } from '@prisma/client';
import prismaClientPackage from '@prisma/client';
import {
  createRideRepository,
  type RideActor,
} from '../dist/ride-repository.js';

const { PrismaClient } = prismaClientPackage;
type PrismaClient = PrismaClientType;

const tenantId = '00000000-0000-7000-8000-000000009001';
const otherTenantId = '00000000-0000-7000-8000-000000009005';
const driverUserId = 'ride-lock-driver';
const membershipId = '00000000-0000-7000-8000-000000009002';
const memberId = '00000000-0000-7000-8000-000000009003';
const planA = '00000000-0000-7000-8000-000000009011';
const planB = '00000000-0000-7000-8000-000000009012';
const otherPlanId = '00000000-0000-7000-8000-000000009015';
const offerA = '00000000-0000-7000-8000-000000009021';
const offerB = '00000000-0000-7000-8000-000000009022';
const requestA = '00000000-0000-7000-8000-000000009031';
const requestB = '00000000-0000-7000-8000-000000009032';
const assignmentA = '00000000-0000-7000-8000-000000009041';
const assignmentB = '00000000-0000-7000-8000-000000009042';

const appUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;
const enabled = Boolean(appUrl && directUrl);
const preparedIntegration = process.env.COCOLO_INTEGRATION_PREPARED === 'true';
const actor: RideActor = {
  tenantId,
  userId: driverUserId,
  role: 'staff',
};

let firstApp: PrismaClient | undefined;
let secondApp: PrismaClient | undefined;
let direct: PrismaClient | undefined;

async function execute(
  client: PrismaClient,
  sql: string,
  ...values: unknown[]
): Promise<void> {
  await client.$executeRawUnsafe(sql, ...values);
}

async function rows<T>(
  client: PrismaClient,
  sql: string,
  ...values: unknown[]
): Promise<T[]> {
  return client.$queryRawUnsafe<T[]>(sql, ...values);
}

function withDatabaseTimeouts(url: string): string {
  const parsed = new URL(url);
  const options = parsed.searchParams.get('options');
  parsed.searchParams.set(
    'options',
    [options, '-c lock_timeout=2000', '-c statement_timeout=4000']
      .filter(Boolean)
      .join(' '),
  );
  parsed.searchParams.set('connect_timeout', '3');
  parsed.searchParams.set('pool_timeout', '3');
  return parsed.toString();
}

async function cleanupFixture(client: PrismaClient): Promise<void> {
  await client.$transaction(async (transaction) => {
    const tx = transaction as unknown as PrismaClient;
    await execute(
      tx,
      'ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only_guard',
    );
    await execute(
      tx,
      'DELETE FROM audit_logs WHERE tenant_id = $1::uuid',
      tenantId,
    );
    await execute(
      tx,
      'ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only_guard',
    );
    await execute(
      tx,
      'DELETE FROM ride_assignments WHERE tenant_id = $1::uuid',
      tenantId,
    );
    await execute(
      tx,
      'DELETE FROM ride_requests WHERE tenant_id = $1::uuid',
      tenantId,
    );
    await execute(
      tx,
      'DELETE FROM ride_offers WHERE tenant_id = $1::uuid',
      tenantId,
    );
    await execute(
      tx,
      'DELETE FROM ride_plans WHERE tenant_id = $1::uuid',
      tenantId,
    );
    await execute(
      tx,
      'DELETE FROM members WHERE tenant_id = $1::uuid',
      tenantId,
    );
    await execute(
      tx,
      'DELETE FROM tenant_memberships WHERE tenant_id = $1::uuid',
      tenantId,
    );
    await execute(tx, 'DELETE FROM tenants WHERE id = $1::uuid', tenantId);
    await execute(
      tx,
      'DELETE FROM ride_plans WHERE id = $1::uuid',
      otherPlanId,
    );
    await execute(tx, 'DELETE FROM tenants WHERE id = $1::uuid', otherTenantId);
  });
}

async function seedFixture(client: PrismaClient): Promise<void> {
  await execute(
    client,
    `INSERT INTO tenants (id, name)
     VALUES ($1::uuid, 'RIDE lock concurrency test')`,
    tenantId,
  );
  await execute(
    client,
    `INSERT INTO tenants (id, name)
     VALUES ($1::uuid, 'RIDE lock tenant boundary test')`,
    otherTenantId,
  );
  await execute(
    client,
    `INSERT INTO tenant_memberships
       (id, tenant_id, user_id, role, status, display_name)
     VALUES ($1::uuid, $2::uuid, $3, 'staff', 'active', '初期表示名')`,
    membershipId,
    tenantId,
    driverUserId,
  );
  await execute(
    client,
    `INSERT INTO members
       (id, tenant_id, name, category, grade_level, status)
     VALUES ($1::uuid, $2::uuid, 'ロック確認部員', 'student', 1, 'active')`,
    memberId,
    tenantId,
  );
  await execute(
    client,
    `INSERT INTO ride_plans (id, tenant_id, title, departure_at, status)
     VALUES
       ($1::uuid, $3::uuid, '同時登録A', '2099-09-01T08:00:00Z', 'draft'),
       ($2::uuid, $3::uuid, '同時登録B', '2099-09-02T08:00:00Z', 'draft')`,
    planA,
    planB,
    tenantId,
  );
  await execute(
    client,
    `UPDATE ride_plans
        SET status = 'open'::ride_plan_status
      WHERE tenant_id = $1::uuid
        AND id IN ($2::uuid, $3::uuid)`,
    tenantId,
    planA,
    planB,
  );
  await execute(
    client,
    `INSERT INTO ride_plans (id, tenant_id, title, departure_at, status)
     VALUES ($1::uuid, $2::uuid, '越境対象', '2099-09-03T08:00:00Z', 'draft')`,
    otherPlanId,
    otherTenantId,
  );
  await execute(
    client,
    `UPDATE ride_plans
        SET status = 'open'::ride_plan_status
      WHERE id = $1::uuid`,
    otherPlanId,
  );
  await execute(
    client,
    `INSERT INTO ride_offers
       (id, tenant_id, plan_id, driver_user_id, capacity, status)
     VALUES
       ($2::uuid, $1::uuid, $3::uuid, $4, 4, 'open'),
       ($5::uuid, $1::uuid, $6::uuid, $4, 4, 'open')`,
    tenantId,
    offerA,
    planA,
    driverUserId,
    offerB,
    planB,
  );
  await execute(
    client,
    `INSERT INTO ride_requests
       (id, tenant_id, plan_id, member_id, requester_user_id, passenger_count, status)
     VALUES
       ($2::uuid, $1::uuid, $3::uuid, $4::uuid, $5, 1, 'pending'),
       ($7::uuid, $1::uuid, $6::uuid, $4::uuid, $5, 1, 'pending')`,
    tenantId,
    requestA,
    planA,
    memberId,
    driverUserId,
    planB,
    requestB,
  );
  await execute(
    client,
    `INSERT INTO ride_assignments
       (id, tenant_id, plan_id, request_id, offer_id, passenger_count)
     VALUES
       ($2::uuid, $1::uuid, $4::uuid, $5::uuid, $6::uuid, 1),
       ($3::uuid, $1::uuid, $7::uuid, $8::uuid, $9::uuid, 1)`,
    tenantId,
    assignmentA,
    assignmentB,
    planA,
    requestA,
    offerA,
    planB,
    requestB,
    offerB,
  );
  await execute(
    client,
    `UPDATE ride_requests
        SET status = 'assigned'::ride_request_status
      WHERE tenant_id = $1::uuid
        AND id IN ($2::uuid, $3::uuid)`,
    tenantId,
    requestA,
    requestB,
  );
}

test('同一運転者の2つのplanへの同時車登録はplan lockの循環待ちを起こさない', {
  skip: !preparedIntegration && !enabled,
  concurrency: false,
}, async () => {
  if (!appUrl || !directUrl)
    throw new Error(
      'RIDE-002の実DB統合テストにはDATABASE_URLとDIRECT_URLが必要です。',
    );
  const appTestUrl = withDatabaseTimeouts(appUrl);
  const first = new PrismaClient({ datasources: { db: { url: appTestUrl } } });
  const second = new PrismaClient({ datasources: { db: { url: appTestUrl } } });
  const migration = new PrismaClient({
    datasources: { db: { url: directUrl } },
  });
  firstApp = first;
  secondApp = second;
  direct = migration;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let concurrentRegistrations:
    | Promise<PromiseSettledResult<unknown>[]>
    | undefined;
  try {
    await cleanupFixture(migration);
    await seedFixture(migration);
    const lockFunctions = [
      {
        signature: 'app_lock_ride_driver_plans(uuid)' as const,
        order: /ORDER BY ro\.tenant_id, ro\.plan_id/,
      },
      {
        signature: 'app_lock_ride_driver_plans(uuid,uuid)' as const,
        order: /ORDER BY locked_plans\.tenant_id, locked_plans\.plan_id/,
      },
    ];
    for (const lockFunction of lockFunctions) {
      const definitions = await rows<{ definition: string }>(
        migration,
        `SELECT pg_get_functiondef($1::regprocedure) AS definition`,
        lockFunction.signature,
      );
      assert.match(definitions[0]?.definition ?? '', lockFunction.order);
    }
    const firstRepository = createRideRepository(first);
    const secondRepository = createRideRepository(second);
    await assert.rejects(() =>
      firstRepository.createOffer(actor, otherPlanId, {
        capacity: 3,
        driverDisplayName: '越境拒否確認',
      }),
    );
    const outsideOffers = await rows<{ count: bigint }>(
      migration,
      `SELECT count(*)::bigint AS count
           FROM ride_offers
          WHERE tenant_id = $1::uuid
            AND plan_id = $2::uuid`,
      otherTenantId,
      otherPlanId,
    );
    assert.equal(Number(outsideOffers[0]?.count ?? 0n), 0);
    const startGate = Promise.resolve();
    concurrentRegistrations = Promise.allSettled([
      startGate.then(() =>
        firstRepository.createOffer(actor, planA, {
          capacity: 3,
          driverDisplayName: '同時登録担当',
        }),
      ),
      startGate.then(() =>
        secondRepository.createOffer(actor, planB, {
          capacity: 3,
          driverDisplayName: '同時登録担当',
        }),
      ),
    ]);
    const outcomes = await Promise.race([
      concurrentRegistrations,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error('2つのplanへの同時車登録がタイムアウトしました。'),
            ),
          5000,
        );
      }),
    ]);
    const errors = outcomes
      .filter(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === 'rejected',
      )
      .map((outcome) =>
        outcome.reason instanceof Error
          ? `${outcome.reason.name}: ${outcome.reason.message}`
          : String(outcome.reason),
      );
    assert.equal(
      errors.length,
      0,
      `同時車登録が失敗しました: ${errors.join(' / ')}`,
    );
    const successfulOffers = outcomes
      .filter(
        (outcome): outcome is PromiseFulfilledResult<RideOffer> =>
          outcome.status === 'fulfilled',
      )
      .map((outcome) => outcome.value);
    assert.deepEqual(
      successfulOffers.map((offer) => offer.planId).sort(),
      [planA, planB].sort(),
    );

    const offerCounts = await rows<{ plan_id: string; count: bigint }>(
      migration,
      `SELECT plan_id, count(*)::bigint AS count
           FROM ride_offers
          WHERE tenant_id = $1::uuid
            AND driver_user_id = $2
          GROUP BY plan_id
          ORDER BY plan_id`,
      tenantId,
      driverUserId,
    );
    assert.deepEqual(
      offerCounts.map((row) => ({
        planId: row.plan_id,
        count: Number(row.count),
      })),
      [
        { planId: planA, count: 2 },
        { planId: planB, count: 2 },
      ],
    );
    const displayName = await rows<{ display_name: string }>(
      migration,
      `SELECT display_name
           FROM tenant_memberships
          WHERE tenant_id = $1::uuid
            AND user_id = $2`,
      tenantId,
      driverUserId,
    );
    assert.equal(displayName[0]?.display_name, '同時登録担当');
    await concurrentRegistrations;
  } finally {
    if (timeout) clearTimeout(timeout);
    await concurrentRegistrations;
    await cleanupFixture(migration);
  }
});

after(async () => {
  await firstApp?.$disconnect();
  await secondApp?.$disconnect();
  await direct?.$disconnect();
});
