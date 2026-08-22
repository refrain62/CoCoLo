import {
  assertCapacity,
  calculateRideMetrics,
  matchRideRequests,
  type RideAssignment,
  type RideMetrics,
  type RideOffer,
  type RidePlan,
  type RideRequest,
  type RideSnapshot,
  validateGoogleMapsUrl,
} from '@cocolo/domain/ride';
import type { Prisma, PrismaClient, Role } from '@prisma/client';

export type RideRole = 'owner' | 'admin' | 'staff' | 'guardian';
export type RideActor = {
  tenantId: string;
  userId: string;
  role: RideRole;
};

export type RidePlanCreateInput = {
  title: string;
  departureAt: string;
  pickupMapsUrl?: string | null;
  destinationMapsUrl?: string | null;
};

export type RideOfferCreateInput = { capacity: number };
export type RideRequestCreateInput = {
  memberId: string;
  passengerCount: number;
};
export type RideAssignmentInput = { requestId: string; offerId: string };

export class RideRepositoryNotFoundError extends Error {
  readonly status = 404;

  constructor() {
    super('送迎対象が見つかりません。');
    this.name = 'RideRepositoryNotFoundError';
  }
}

export class RideRepositoryConflictError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'RideRepositoryConflictError';
  }
}

export class RideRepositoryForbiddenError extends Error {
  readonly status = 403;

  constructor() {
    super('送迎操作の権限がありません。');
    this.name = 'RideRepositoryForbiddenError';
  }
}

export type RideRepository = {
  createPlan: (
    actor: RideActor,
    input: RidePlanCreateInput,
  ) => Promise<RidePlan>;
  createOffer: (
    actor: RideActor,
    planId: string,
    input: RideOfferCreateInput,
  ) => Promise<RideOffer>;
  createRequest: (
    actor: RideActor,
    planId: string,
    input: RideRequestCreateInput,
  ) => Promise<RideRequest>;
  getSnapshot: (actor: RideActor, planId: string) => Promise<RideSnapshot>;
  autoMatch: (
    actor: RideActor,
    planId: string,
  ) => Promise<{
    assignments: RideAssignment[];
    unassignedRequestIds: string[];
  }>;
  assign: (
    actor: RideActor,
    planId: string,
    input: RideAssignmentInput,
  ) => Promise<RideAssignment>;
};

type DatabaseClient = PrismaClient | Prisma.TransactionClient;
type SqlDate = Date | string;

type PlanRow = {
  id: string;
  tenant_id: string;
  title: string;
  departure_at: SqlDate;
  pickup_maps_url: string | null;
  destination_maps_url: string | null;
  status: RidePlan['status'];
  created_at: SqlDate;
};
type OfferRow = {
  id: string;
  plan_id: string;
  driver_user_id: string;
  capacity: number;
  status: RideOffer['status'];
  created_at: SqlDate;
};
type RequestRow = {
  id: string;
  plan_id: string;
  member_id: string;
  requester_user_id: string;
  passenger_count: number;
  status: RideRequest['status'];
  created_at: SqlDate;
};
type AssignmentRow = {
  id: string;
  plan_id: string;
  request_id: string;
  offer_id: string;
  passenger_count: number;
  created_at: SqlDate;
};

const managerRoles = new Set<RideRole>(['owner', 'admin', 'staff']);

function isoDate(value: SqlDate) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toPlan(row: PlanRow): RidePlan {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    departureAt: isoDate(row.departure_at),
    pickupMapsUrl: row.pickup_maps_url,
    destinationMapsUrl: row.destination_maps_url,
    status: row.status,
    createdAt: isoDate(row.created_at),
  };
}

function toOffer(row: OfferRow): RideOffer {
  return {
    id: row.id,
    planId: row.plan_id,
    driverUserId: row.driver_user_id,
    capacity: row.capacity,
    status: row.status,
    createdAt: isoDate(row.created_at),
  };
}

function toRequest(row: RequestRow): RideRequest {
  return {
    id: row.id,
    planId: row.plan_id,
    memberId: row.member_id,
    requesterUserId: row.requester_user_id,
    passengerCount: row.passenger_count,
    status: row.status,
    createdAt: isoDate(row.created_at),
  };
}

function toAssignment(row: AssignmentRow): RideAssignment {
  return {
    id: row.id,
    planId: row.plan_id,
    requestId: row.request_id,
    offerId: row.offer_id,
    passengerCount: row.passenger_count,
    createdAt: isoDate(row.created_at),
  };
}

// DB操作の前にtenant・user・roleをtransaction-localへ設定し、アプリ側の条件だけに依存しない。
async function setRlsContext(client: DatabaseClient, actor: RideActor) {
  await client.$executeRaw`
    SELECT
      set_config('app.tenant_id', ${actor.tenantId}, true),
      set_config('app.user_id', ${actor.userId}, true),
      set_config('app.role', ${actor.role}, true)
  `;
}

// 認証時に得た所属を同一transactionで再確認し、処理中の権限変更やtenant差し替えを拒否する。
async function assertActiveMembership(
  client: Prisma.TransactionClient,
  actor: RideActor,
) {
  const membership = await client.tenantMembership.findUnique({
    where: {
      tenantId_userId: { tenantId: actor.tenantId, userId: actor.userId },
    },
    select: { role: true, status: true },
  });
  if (
    membership?.status !== 'active' ||
    membership.role !== (actor.role as Role)
  )
    throw new RideRepositoryForbiddenError();
}

async function lockPlan(
  client: Prisma.TransactionClient,
  actor: RideActor,
  planId: string,
) {
  // 車・希望・割当を同じplan単位で直列化し、残席計算とINSERTの間の競合をなくす。
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`${actor.tenantId}:${planId}`}, 0)
    )
  `;
}

async function requirePlan(
  client: Prisma.TransactionClient,
  actor: RideActor,
  planId: string,
) {
  const rows = await client.$queryRaw<PlanRow[]>`
    SELECT id, tenant_id, title, departure_at, pickup_maps_url,
           destination_maps_url, status, created_at
      FROM ride_plans
     WHERE tenant_id = ${actor.tenantId}::uuid
       AND id = ${planId}::uuid
     FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new RideRepositoryNotFoundError();
  return toPlan(row);
}

async function runInRideTransaction<T>(
  client: PrismaClient,
  actor: RideActor,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return client.$transaction(async (tx) => {
    await setRlsContext(tx, actor);
    await assertActiveMembership(tx, actor);
    return work(tx);
  });
}

async function readSnapshot(
  client: Prisma.TransactionClient,
  actor: RideActor,
  plan: RidePlan,
): Promise<RideSnapshot> {
  const manager = managerRoles.has(actor.role);
  const offers = await client.$queryRaw<OfferRow[]>`
    SELECT id, plan_id, driver_user_id, capacity, status, created_at
      FROM ride_offers
     WHERE tenant_id = ${actor.tenantId}::uuid
       AND plan_id = ${plan.id}::uuid
       AND (${manager} OR driver_user_id = ${actor.userId})
     ORDER BY created_at ASC, id ASC
  `;
  const requests = await client.$queryRaw<RequestRow[]>`
    SELECT id, plan_id, member_id, requester_user_id, passenger_count,
           status, created_at
      FROM ride_requests
     WHERE tenant_id = ${actor.tenantId}::uuid
       AND plan_id = ${plan.id}::uuid
       AND (
         ${manager}
         OR requester_user_id = ${actor.userId}
         OR EXISTS (
           SELECT 1
             FROM guardian_members gm
            WHERE gm.tenant_id = ${actor.tenantId}::uuid
              AND gm.user_id = ${actor.userId}
              AND gm.member_id = ride_requests.member_id
         )
       )
     ORDER BY created_at ASC, id ASC
  `;
  const assignments = await client.$queryRaw<AssignmentRow[]>`
    SELECT a.id, a.plan_id, a.request_id, a.offer_id, a.passenger_count,
           a.created_at
      FROM ride_assignments a
      JOIN ride_requests r
        ON r.tenant_id = a.tenant_id AND r.id = a.request_id
      JOIN ride_offers o
        ON o.tenant_id = a.tenant_id AND o.id = a.offer_id
     WHERE a.tenant_id = ${actor.tenantId}::uuid
       AND a.plan_id = ${plan.id}::uuid
       AND (
         ${manager}
         OR r.requester_user_id = ${actor.userId}
         OR o.driver_user_id = ${actor.userId}
       )
     ORDER BY a.created_at ASC, a.id ASC
  `;
  return {
    plan,
    offers: offers.map(toOffer),
    requests: requests.map(toRequest),
    assignments: assignments.map(toAssignment),
  };
}

async function appendAudit(
  client: Prisma.TransactionClient,
  actor: RideActor,
  input: {
    action: string;
    resourceId: string;
    metadata: Prisma.InputJsonValue;
  },
) {
  await client.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: input.action,
      resourceType: 'ride_plan',
      resourceId: input.resourceId,
      metadata: input.metadata,
    },
  });
}

// 送迎の書き込みをRLS context・行ロック・監査INSERTと同じtransactionへ閉じ込める。
export function createRideRepository(client: PrismaClient): RideRepository {
  return {
    async createPlan(actor, input) {
      const title = input.title.trim();
      const departureAt = new Date(input.departureAt);
      if (
        title.length === 0 ||
        title.length > 200 ||
        Number.isNaN(departureAt.getTime())
      )
        throw new RideRepositoryConflictError('送迎予定の入力が不正です。');
      const pickupMapsUrl = validateGoogleMapsUrl(input.pickupMapsUrl);
      const destinationMapsUrl = validateGoogleMapsUrl(
        input.destinationMapsUrl,
      );
      if (!managerRoles.has(actor.role))
        throw new RideRepositoryForbiddenError();
      return runInRideTransaction(client, actor, async (tx) => {
        const rows = await tx.$queryRaw<PlanRow[]>`
          INSERT INTO ride_plans (
            tenant_id, title, departure_at, pickup_maps_url,
            destination_maps_url, status
          ) VALUES (
            ${actor.tenantId}::uuid, ${title}, ${departureAt},
            ${pickupMapsUrl}, ${destinationMapsUrl}, 'open'
          )
          RETURNING id, tenant_id, title, departure_at, pickup_maps_url,
                    destination_maps_url, status, created_at
        `;
        const row = rows[0];
        if (!row)
          throw new RideRepositoryConflictError('送迎予定を作成できません。');
        const plan = toPlan(row);
        await appendAudit(tx, actor, {
          action: 'ride.plan.create',
          resourceId: plan.id,
          metadata: { status: plan.status },
        });
        return plan;
      });
    },

    async createOffer(actor, planId, input) {
      if (
        !Number.isInteger(input.capacity) ||
        input.capacity < 1 ||
        input.capacity > 20
      )
        throw new RideRepositoryConflictError(
          '乗車可能数は1〜20人で指定してください。',
        );
      return runInRideTransaction(client, actor, async (tx) => {
        await lockPlan(tx, actor, planId);
        const plan = await requirePlan(tx, actor, planId);
        if (plan.status !== 'open')
          throw new RideRepositoryConflictError(
            '受付中でない送迎には車を登録できません。',
          );
        const rows = await tx.$queryRaw<OfferRow[]>`
          INSERT INTO ride_offers
            (tenant_id, plan_id, driver_user_id, capacity, status)
          VALUES
            (${actor.tenantId}::uuid, ${plan.id}::uuid, ${actor.userId}, ${input.capacity}, 'open')
          RETURNING id, plan_id, driver_user_id, capacity, status, created_at
        `;
        const row = rows[0];
        if (!row) throw new RideRepositoryConflictError('車を登録できません。');
        const offer = toOffer(row);
        await appendAudit(tx, actor, {
          action: 'ride.offer.create',
          resourceId: plan.id,
          metadata: { offerId: offer.id, capacity: offer.capacity },
        });
        return offer;
      });
    },

    async createRequest(actor, planId, input) {
      if (
        !Number.isInteger(input.passengerCount) ||
        input.passengerCount < 1 ||
        input.passengerCount > 8
      )
        throw new RideRepositoryConflictError(
          '乗車希望人数は1〜8人で指定してください。',
        );
      return runInRideTransaction(client, actor, async (tx) => {
        await lockPlan(tx, actor, planId);
        const plan = await requirePlan(tx, actor, planId);
        if (plan.status !== 'open')
          throw new RideRepositoryConflictError(
            '受付中でない送迎には乗車希望を登録できません。',
          );
        const rows = await tx.$queryRaw<RequestRow[]>`
          INSERT INTO ride_requests (
            tenant_id, plan_id, member_id, requester_user_id,
            passenger_count, status
          )
          SELECT ${actor.tenantId}::uuid, ${plan.id}::uuid, m.id,
                 ${actor.userId}, ${input.passengerCount}, 'pending'
            FROM members m
           WHERE m.tenant_id = ${actor.tenantId}::uuid
             AND m.id = ${input.memberId}::uuid
             AND m.status <> 'retired'
             AND (
               ${managerRoles.has(actor.role)}
               OR EXISTS (
                 SELECT 1
                   FROM guardian_members gm
                  WHERE gm.tenant_id = ${actor.tenantId}::uuid
                    AND gm.user_id = ${actor.userId}
                    AND gm.member_id = m.id
               )
             )
          RETURNING id, plan_id, member_id, requester_user_id,
                    passenger_count, status, created_at
        `;
        const row = rows[0];
        if (!row) throw new RideRepositoryForbiddenError();
        const request = toRequest(row);
        await appendAudit(tx, actor, {
          action: 'ride.request.create',
          resourceId: plan.id,
          metadata: {
            requestId: request.id,
            passengerCount: request.passengerCount,
          },
        });
        return request;
      });
    },

    async getSnapshot(actor, planId) {
      return runInRideTransaction(client, actor, async (tx) => {
        const plan = await requirePlan(tx, actor, planId);
        return readSnapshot(tx, actor, plan);
      });
    },

    async autoMatch(actor, planId) {
      if (!managerRoles.has(actor.role))
        throw new RideRepositoryForbiddenError();
      return runInRideTransaction(client, actor, async (tx) => {
        await lockPlan(tx, actor, planId);
        const plan = await requirePlan(tx, actor, planId);
        if (plan.status !== 'open')
          throw new RideRepositoryConflictError(
            '受付中でない送迎は割り当てできません。',
          );
        const snapshot = await readSnapshot(tx, actor, plan);
        const decisions = matchRideRequests(snapshot);
        const decisionIds = new Set(decisions.map((item) => item.requestId));
        const unassignedRequestIds = snapshot.requests
          .filter(
            (request) =>
              (request.status === 'pending' ||
                request.status === 'unassigned') &&
              !decisionIds.has(request.id),
          )
          .map((request) => request.id);
        const assignments: RideAssignment[] = [];
        for (const decision of decisions) {
          const rows = await tx.$queryRaw<AssignmentRow[]>`
            INSERT INTO ride_assignments (
              tenant_id, plan_id, request_id, offer_id, passenger_count
            ) VALUES (
              ${actor.tenantId}::uuid, ${plan.id}::uuid,
              ${decision.requestId}::uuid, ${decision.offerId}::uuid,
              ${decision.passengerCount}
            )
            RETURNING id, plan_id, request_id, offer_id,
                      passenger_count, created_at
          `;
          const row = rows[0];
          if (!row)
            throw new RideRepositoryConflictError('割当を保存できません。');
          await tx.$executeRaw`
            UPDATE ride_requests
               SET status = 'assigned'
             WHERE tenant_id = ${actor.tenantId}::uuid
               AND id = ${decision.requestId}::uuid
          `;
          assignments.push(toAssignment(row));
        }
        for (const requestId of unassignedRequestIds)
          await tx.$executeRaw`
            UPDATE ride_requests
               SET status = 'unassigned'
             WHERE tenant_id = ${actor.tenantId}::uuid
               AND id = ${requestId}::uuid
          `;
        await appendAudit(tx, actor, {
          action: 'ride.match.execute',
          resourceId: plan.id,
          metadata: {
            assignedRequestCount: assignments.length,
            unassignedRequestCount: unassignedRequestIds.length,
          },
        });
        return { assignments, unassignedRequestIds };
      });
    },

    async assign(actor, planId, input) {
      if (!managerRoles.has(actor.role))
        throw new RideRepositoryForbiddenError();
      return runInRideTransaction(client, actor, async (tx) => {
        await lockPlan(tx, actor, planId);
        const plan = await requirePlan(tx, actor, planId);
        if (plan.status !== 'open')
          throw new RideRepositoryConflictError(
            '受付中でない送迎は割り当てできません。',
          );
        const requestRows = await tx.$queryRaw<RequestRow[]>`
          SELECT id, plan_id, member_id, requester_user_id, passenger_count,
                 status, created_at
            FROM ride_requests
           WHERE tenant_id = ${actor.tenantId}::uuid
             AND plan_id = ${plan.id}::uuid
             AND id = ${input.requestId}::uuid
           FOR UPDATE
        `;
        const request = requestRows[0];
        if (!request || request.status === 'cancelled')
          throw new RideRepositoryNotFoundError();
        const offerRows = await tx.$queryRaw<OfferRow[]>`
          SELECT id, plan_id, driver_user_id, capacity, status, created_at
            FROM ride_offers
           WHERE tenant_id = ${actor.tenantId}::uuid
             AND plan_id = ${plan.id}::uuid
             AND id = ${input.offerId}::uuid
           FOR UPDATE
        `;
        const offer = offerRows[0];
        if (offer?.status !== 'open') throw new RideRepositoryNotFoundError();
        const previousRows = await tx.$queryRaw<AssignmentRow[]>`
          SELECT id, plan_id, request_id, offer_id, passenger_count, created_at
            FROM ride_assignments
           WHERE tenant_id = ${actor.tenantId}::uuid
             AND request_id = ${request.id}::uuid
           FOR UPDATE
        `;
        const previous = previousRows[0];
        if (previous?.offer_id === offer.id) return toAssignment(previous);
        const assignedRows = await tx.$queryRaw<
          Array<{ assigned_seats: number | null }>
        >`
          SELECT COALESCE(SUM(passenger_count), 0)::int AS assigned_seats
            FROM ride_assignments
           WHERE tenant_id = ${actor.tenantId}::uuid
             AND offer_id = ${offer.id}::uuid
             AND request_id <> ${request.id}::uuid
        `;
        assertCapacity({
          capacity: offer.capacity,
          assignedSeats: assignedRows[0]?.assigned_seats ?? 0,
          requestedSeats: request.passenger_count,
        });
        if (previous)
          await tx.$executeRaw`
            DELETE FROM ride_assignments
             WHERE tenant_id = ${actor.tenantId}::uuid
               AND id = ${previous.id}::uuid
          `;
        const assignmentRows = await tx.$queryRaw<AssignmentRow[]>`
          INSERT INTO ride_assignments (
            tenant_id, plan_id, request_id, offer_id, passenger_count
          ) VALUES (
            ${actor.tenantId}::uuid, ${plan.id}::uuid,
            ${request.id}::uuid, ${offer.id}::uuid, ${request.passenger_count}
          )
          RETURNING id, plan_id, request_id, offer_id,
                    passenger_count, created_at
        `;
        const row = assignmentRows[0];
        if (!row)
          throw new RideRepositoryConflictError('割当を保存できません。');
        await tx.$executeRaw`
          UPDATE ride_requests
             SET status = 'assigned'
           WHERE tenant_id = ${actor.tenantId}::uuid
             AND id = ${request.id}::uuid
        `;
        const assignment = toAssignment(row);
        await appendAudit(tx, actor, {
          action: 'ride.assignment.update',
          resourceId: plan.id,
          metadata: {
            requestId: request.id,
            offerId: offer.id,
            previousOfferId: previous?.offer_id ?? null,
          },
        });
        return assignment;
      });
    },
  };
}

export function calculateRideMetricsFromSnapshot(
  snapshot: RideSnapshot,
): RideMetrics {
  return calculateRideMetrics(snapshot);
}
