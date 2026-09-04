import {
  assertCapacity,
  calculateRideMetrics,
  matchRideRequests,
  type RideAssignment,
  type RideConfirmedAssignment,
  type RideHistoryEntry,
  type RideMetrics,
  type RideOffer,
  type RidePlan,
  type RideRequest,
  type RideSnapshot,
  validateGoogleMapsUrl,
} from '@cocolo/domain/ride';
import type { Prisma, PrismaClient, Role } from '@prisma/client';
import { findAuthorizedSubjectMember } from './subject-member-access.js';
import { uuidv7 } from './uuidv7.js';

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

export type RidePlanUpdateInput = {
  title?: string;
  departureAt?: string;
  pickupMapsUrl?: string | null;
  destinationMapsUrl?: string | null;
};

export type RideOfferCreateInput = {
  capacity: number;
  driverDisplayName?: string;
};
export type RideDisplayNameUpdateInput = {
  displayName: string;
};
export type RideRequestCreateInput = {
  memberId: string;
  passengerCount: number;
};
export type RideAssignmentInput = {
  requestId: string;
  offerId: string;
  expectedOfferId: string | null;
};
export type RidePlanTransitionInput =
  | { action: 'close' | 'finalize' }
  | {
      action: 'reopen';
      reasonCode:
        | 'schedule_change'
        | 'member_change'
        | 'vehicle_change'
        | 'other';
    };

export class RideRepositoryNotFoundError extends Error {
  readonly status = 404;

  constructor() {
    super('送迎対象が見つかりません。');
    this.name = 'RideRepositoryNotFoundError';
  }
}

export class RideRepositoryConflictError extends Error {
  readonly status = 409;
  readonly code: string;

  constructor(message: string, code = 'RIDE_STATE_CONFLICT') {
    super(message);
    this.code = code;
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

const MAX_RIDE_COLLECTION_ITEMS = 100;
const MAX_RIDE_HISTORY_ITEMS = 1000;

function assertRideCollectionSize(size: number, max: number, label: string) {
  if (size > max)
    throw new RideRepositoryConflictError(
      `${label}が多すぎるため、一覧を表示できません。`,
      'RIDE_RESULT_TOO_LARGE',
    );
}

export type RideRepository = {
  listPlans: (actor: RideActor) => Promise<RidePlan[]>;
  createPlan: (
    actor: RideActor,
    input: RidePlanCreateInput,
  ) => Promise<RidePlan>;
  updatePlan: (
    actor: RideActor,
    planId: string,
    input: RidePlanUpdateInput,
  ) => Promise<RidePlan>;
  createOffer: (
    actor: RideActor,
    planId: string,
    input: RideOfferCreateInput,
  ) => Promise<RideOffer>;
  setDisplayName: (
    actor: RideActor,
    input: RideDisplayNameUpdateInput,
  ) => Promise<string>;
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
  transitionPlan: (
    actor: RideActor,
    planId: string,
    input: RidePlanTransitionInput,
  ) => Promise<RidePlan>;
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
type ConfirmedAssignmentRow = {
  id: string;
  request_id: string;
  offer_id: string;
  passenger_count: number;
  member_name: string;
  driver_name: string;
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

function toHistory(row: {
  id: string;
  action: string;
  createdAt: Date;
}): RideHistoryEntry {
  const actionMap: Record<string, RideHistoryEntry['action']> = {
    'ride.plan.create': 'plan_created',
    'ride.offer.create': 'offer_registered',
    'ride.request.create': 'request_registered',
    'ride.match.execute': 'matching_executed',
    'ride.assignment.update': 'assignment_updated',
    'ride.plan.close': 'plan_closed',
    'ride.plan.finalize': 'plan_finalized',
    'ride.plan.reopen': 'plan_reopened',
  };
  return {
    id: row.id,
    action: actionMap[row.action] ?? 'other',
    createdAt: row.createdAt.toISOString(),
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
      FROM app_ride_plan_row(
        ${actor.tenantId}::uuid,
        ${planId}::uuid
      )
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
       AND (
         ${manager}
         OR driver_user_id = ${actor.userId}
         OR (
           ${plan.status === 'finalized'}
           AND EXISTS (
             SELECT 1
               FROM ride_assignments ra
               JOIN ride_requests rr
                 ON rr.tenant_id = ra.tenant_id AND rr.id = ra.request_id
              WHERE ra.tenant_id = ride_offers.tenant_id
                AND ra.plan_id = ride_offers.plan_id
                AND ra.offer_id = ride_offers.id
                AND (
                  rr.requester_user_id = ${actor.userId}
                  OR EXISTS (
                    SELECT 1
                      FROM guardian_members gm
                     WHERE gm.tenant_id = rr.tenant_id
                       AND gm.member_id = rr.member_id
                       AND gm.user_id = ${actor.userId}
                       AND gm.status = 'active'::member_link_status
                  )
                )
           )
         )
       )
     ORDER BY created_at ASC, id ASC
     LIMIT ${MAX_RIDE_COLLECTION_ITEMS + 1}
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
              AND gm.status = 'active'::member_link_status
         )
       )
     ORDER BY created_at ASC, id ASC
     LIMIT ${MAX_RIDE_COLLECTION_ITEMS + 1}
  `;
  const assignments = await client.$queryRaw<AssignmentRow[]>`
    SELECT a.id, a.plan_id, a.request_id, a.offer_id, a.passenger_count,
           a.created_at
      FROM ride_assignments a
      LEFT JOIN ride_requests r
        ON r.tenant_id = a.tenant_id AND r.id = a.request_id
      LEFT JOIN ride_offers o
        ON o.tenant_id = a.tenant_id AND o.id = a.offer_id
     WHERE a.tenant_id = ${actor.tenantId}::uuid
       AND a.plan_id = ${plan.id}::uuid
         AND (
         ${manager}
         OR (
           ${plan.status === 'finalized'}
           AND (
             r.requester_user_id = ${actor.userId}
             OR o.driver_user_id = ${actor.userId}
             OR EXISTS (
               SELECT 1
                 FROM guardian_members gm
                WHERE gm.tenant_id = ${actor.tenantId}::uuid
                  AND gm.user_id = ${actor.userId}
                  AND gm.member_id = r.member_id
                  AND gm.status = 'active'::member_link_status
             )
           )
         )
       )
     ORDER BY a.created_at ASC, a.id ASC
     LIMIT ${MAX_RIDE_COLLECTION_ITEMS + 1}
  `;
  const confirmedAssignments =
    plan.status === 'finalized'
      ? await client.$queryRaw<ConfirmedAssignmentRow[]>`
          SELECT id, request_id, offer_id, passenger_count,
                 member_name, driver_name
            FROM app_ride_confirmed_assignments(
              ${actor.tenantId}::uuid,
              ${plan.id}::uuid
            )
           ORDER BY id ASC
           LIMIT ${MAX_RIDE_COLLECTION_ITEMS + 1}
        `
      : [];
  assertRideCollectionSize(offers.length, MAX_RIDE_COLLECTION_ITEMS, '車');
  assertRideCollectionSize(
    requests.length,
    MAX_RIDE_COLLECTION_ITEMS,
    '乗車希望',
  );
  assertRideCollectionSize(
    assignments.length,
    MAX_RIDE_COLLECTION_ITEMS,
    '割当',
  );
  assertRideCollectionSize(
    confirmedAssignments.length,
    MAX_RIDE_COLLECTION_ITEMS,
    '確定配車',
  );
  const history = await client.auditLog.findMany({
    where: {
      tenantId: actor.tenantId,
      resourceType: 'ride_plan',
      resourceId: plan.id,
      action: { startsWith: 'ride.' },
    },
    orderBy: { createdAt: 'asc' },
    take: MAX_RIDE_HISTORY_ITEMS + 1,
    select: { id: true, action: true, createdAt: true },
  });
  assertRideCollectionSize(history.length, MAX_RIDE_HISTORY_ITEMS, '変更履歴');
  return {
    plan:
      manager || plan.status === 'finalized'
        ? plan
        : {
            ...plan,
            pickupMapsUrl: null,
            destinationMapsUrl: null,
          },
    offers: offers.map(toOffer),
    requests: requests.map(toRequest),
    assignments: assignments.map(toAssignment),
    confirmedAssignments: confirmedAssignments.map(
      (row): RideConfirmedAssignment => ({
        id: row.id,
        requestId: row.request_id,
        offerId: row.offer_id,
        passengerCount: row.passenger_count,
        memberName: row.member_name,
        driverName: row.driver_name,
      }),
    ),
    history: history.map(toHistory),
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
  // audit_logsはstaffのSELECTを許可していないため、RETURNINGを発生させるPrisma createを使わない。
  await client.$executeRaw`
    INSERT INTO audit_logs
      (id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
    VALUES
      (app_uuidv7(), ${actor.tenantId}::uuid, ${actor.userId}, ${input.action},
       'ride_plan', ${input.resourceId}::uuid, ${input.metadata})
  `;
}

// 送迎の書き込みをRLS context・行ロック・監査INSERTと同じtransactionへ閉じ込める。
export function createRideRepository(client: PrismaClient): RideRepository {
  return {
    async listPlans(actor) {
      return runInRideTransaction(client, actor, async (tx) => {
        const rows = await tx.$queryRaw<PlanRow[]>`
          SELECT id, tenant_id, title, departure_at, pickup_maps_url,
                 destination_maps_url, status, created_at
            FROM app_ride_plan_rows(${actor.tenantId}::uuid)
        `;
        return rows.map((row) => {
          const plan = toPlan(row);
          return managerRoles.has(actor.role) || plan.status === 'finalized'
            ? plan
            : {
                ...plan,
                pickupMapsUrl: null,
                destinationMapsUrl: null,
              };
        });
      });
    },

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
          WITH created AS (
            INSERT INTO ride_plans (
              id, tenant_id, title, departure_at, pickup_maps_url,
              destination_maps_url, status
            ) VALUES (
              ${uuidv7()}::uuid, ${actor.tenantId}::uuid, ${title}, ${departureAt},
              ${pickupMapsUrl}, ${destinationMapsUrl}, 'draft'
            )
            RETURNING id
          )
          UPDATE ride_plans
             SET status = 'open'
            FROM created
           WHERE ride_plans.tenant_id = ${actor.tenantId}::uuid
             AND ride_plans.id = created.id
          RETURNING id, tenant_id, title, departure_at, status, created_at
        `;
        const row = rows[0];
        if (!row)
          throw new RideRepositoryConflictError('送迎予定を作成できません。');
        const planRows = await tx.$queryRaw<PlanRow[]>`
          SELECT id, tenant_id, title, departure_at, pickup_maps_url,
                 destination_maps_url, status, created_at
            FROM app_ride_plan_row(
              ${actor.tenantId}::uuid,
              ${row.id}::uuid
            )
        `;
        const plan = toPlan(planRows[0] ?? row);
        await appendAudit(tx, actor, {
          action: 'ride.plan.create',
          resourceId: plan.id,
          metadata: { status: plan.status },
        });
        return plan;
      });
    },

    async updatePlan(actor, planId, input) {
      if (!managerRoles.has(actor.role))
        throw new RideRepositoryForbiddenError();
      const title = input.title?.trim();
      if (input.title !== undefined && (!title || title.length > 200))
        throw new RideRepositoryConflictError('送迎予定のタイトルが不正です。');
      const departureAt =
        input.departureAt === undefined ? null : new Date(input.departureAt);
      if (departureAt && Number.isNaN(departureAt.getTime()))
        throw new RideRepositoryConflictError('出発日時が不正です。');
      const pickupMapsUrl =
        input.pickupMapsUrl === undefined
          ? null
          : validateGoogleMapsUrl(input.pickupMapsUrl);
      const destinationMapsUrl =
        input.destinationMapsUrl === undefined
          ? null
          : validateGoogleMapsUrl(input.destinationMapsUrl);
      const hasTitle = input.title !== undefined;
      const hasDepartureAt = input.departureAt !== undefined;
      const hasPickupMapsUrl = input.pickupMapsUrl !== undefined;
      const hasDestinationMapsUrl = input.destinationMapsUrl !== undefined;
      return runInRideTransaction(client, actor, async (tx) => {
        await lockPlan(tx, actor, planId);
        const plan = await requirePlan(tx, actor, planId);
        if (plan.status === 'finalized')
          throw new RideRepositoryConflictError(
            '公開済みの送迎は再編集を開始してから変更してください。',
          );
        const rows = await tx.$queryRaw<PlanRow[]>`
          UPDATE ride_plans
             SET title = CASE WHEN ${hasTitle} THEN ${title ?? ''} ELSE title END,
                 departure_at = CASE WHEN ${hasDepartureAt}
                   THEN ${departureAt ?? new Date(0)} ELSE departure_at END,
                 pickup_maps_url = CASE WHEN ${hasPickupMapsUrl}
                   THEN ${pickupMapsUrl} ELSE pickup_maps_url END,
                 destination_maps_url = CASE WHEN ${hasDestinationMapsUrl}
                   THEN ${destinationMapsUrl} ELSE destination_maps_url END
           WHERE tenant_id = ${actor.tenantId}::uuid
             AND id = ${plan.id}::uuid
           RETURNING id, tenant_id, title, departure_at, status, created_at
        `;
        const row = rows[0];
        if (!row)
          throw new RideRepositoryConflictError('送迎予定を変更できません。');
        const planRows = await tx.$queryRaw<PlanRow[]>`
          SELECT id, tenant_id, title, departure_at, pickup_maps_url,
                 destination_maps_url, status, created_at
            FROM app_ride_plan_row(
              ${actor.tenantId}::uuid,
              ${plan.id}::uuid
            )
        `;
        const updated = toPlan(planRows[0] ?? row);
        await appendAudit(tx, actor, {
          action: 'ride.plan.update',
          resourceId: updated.id,
          metadata: {
            changedFields: [
              ...(hasTitle ? ['title'] : []),
              ...(hasDepartureAt ? ['departureAt'] : []),
              ...(hasPickupMapsUrl ? ['pickupMapsUrl'] : []),
              ...(hasDestinationMapsUrl ? ['destinationMapsUrl'] : []),
            ],
            status: updated.status,
          },
        });
        return updated;
      });
    },

    async createOffer(actor, planId, input) {
      const driverDisplayName = input.driverDisplayName?.trim();
      if (
        !Number.isInteger(input.capacity) ||
        input.capacity < 1 ||
        input.capacity > 20
      )
        throw new RideRepositoryConflictError(
          '乗車可能数は1〜20人で指定してください。',
        );
      if (
        input.driverDisplayName !== undefined &&
        (!driverDisplayName || driverDisplayName.length > 200)
      )
        throw new RideRepositoryConflictError('運転者の表示名が不正です。');
      return runInRideTransaction(client, actor, async (tx) => {
        if (driverDisplayName !== undefined) {
          // 表示名更新が取得する全plan lockを、plan lockより先に揃える。
          await tx.$executeRaw`
            SELECT app_lock_ride_driver_plans(
              ${actor.tenantId}::uuid,
              ${planId}::uuid
            )
          `;
        }
        await lockPlan(tx, actor, planId);
        const plan = await requirePlan(tx, actor, planId);
        if (plan.status !== 'open')
          throw new RideRepositoryConflictError(
            '受付中でない送迎には車を登録できません。',
          );
        if (driverDisplayName !== undefined) {
          await tx.$queryRaw`
            SELECT app_set_ride_display_name(
              ${actor.tenantId}::uuid,
              ${driverDisplayName}
            )
          `;
        }
        const rows = await tx.$queryRaw<OfferRow[]>`
          INSERT INTO ride_offers
            (id, tenant_id, plan_id, driver_user_id, capacity, status)
          VALUES
            (${uuidv7()}::uuid, ${actor.tenantId}::uuid, ${plan.id}::uuid,
             ${actor.userId}, ${input.capacity}, 'open')
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

    async setDisplayName(actor, input) {
      const displayName = input.displayName.trim();
      if (!displayName || displayName.length > 200)
        throw new RideRepositoryConflictError('運転者の表示名が不正です。');
      try {
        return await runInRideTransaction(client, actor, async (tx) => {
          const rows = await tx.$queryRaw<Array<{ display_name: string }>>`
            SELECT app_set_ride_display_name(
              ${actor.tenantId}::uuid,
              ${displayName}
            ) AS display_name
          `;
          const row = rows[0];
          if (!row?.display_name)
            throw new RideRepositoryConflictError(
              '運転者の表示名を更新できません。',
            );
          return row.display_name;
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('確定公開中の運転者名')
        )
          throw new RideRepositoryConflictError(
            '確定公開中の送迎があるため、表示名を変更できません。予定を再編集に戻してから変更してください。',
          );
        throw error;
      }
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
        if (
          (await findAuthorizedSubjectMember(
            tx,
            { ...actor, actorUserId: actor.userId },
            input.memberId,
          )) === null
        )
          throw new RideRepositoryForbiddenError();
        const rows = await tx.$queryRaw<RequestRow[]>`
          INSERT INTO ride_requests (
            id, tenant_id, plan_id, member_id, requester_user_id,
            passenger_count, status
          )
          SELECT ${uuidv7()}::uuid, ${actor.tenantId}::uuid, ${plan.id}::uuid, m.id,
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
                   AND gm.status = 'active'::member_link_status
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
            subjectMemberId: request.memberId,
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
        if (plan.status !== 'open' && plan.status !== 'closed')
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
              id, tenant_id, plan_id, request_id, offer_id, passenger_count
            ) VALUES (
              ${uuidv7()}::uuid, ${actor.tenantId}::uuid, ${plan.id}::uuid,
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
        if (plan.status !== 'open' && plan.status !== 'closed')
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
        if ((previous?.offer_id ?? null) !== input.expectedOfferId)
          throw new RideRepositoryConflictError(
            '表示中の割当が更新済みのため、画面を再読み込みしてください。',
            'RIDE_STATE_CONFLICT',
          );
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
        const assignmentRows = previous
          ? await tx.$queryRaw<AssignmentRow[]>`
              UPDATE ride_assignments
                 SET offer_id = ${offer.id}::uuid,
                     passenger_count = ${request.passenger_count}
               WHERE tenant_id = ${actor.tenantId}::uuid
                 AND id = ${previous.id}::uuid
               RETURNING id, plan_id, request_id, offer_id,
                         passenger_count, created_at
            `
          : await tx.$queryRaw<AssignmentRow[]>`
              INSERT INTO ride_assignments (
                id, tenant_id, plan_id, request_id, offer_id, passenger_count
              ) VALUES (
                ${uuidv7()}::uuid, ${actor.tenantId}::uuid, ${plan.id}::uuid,
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

    async transitionPlan(actor, planId, input) {
      if (!managerRoles.has(actor.role))
        throw new RideRepositoryForbiddenError();
      return runInRideTransaction(client, actor, async (tx) => {
        await lockPlan(tx, actor, planId);
        const plan = await requirePlan(tx, actor, planId);
        const targetStatus =
          input.action === 'close'
            ? 'closed'
            : input.action === 'finalize'
              ? 'finalized'
              : 'closed';
        const expectedStatus =
          input.action === 'close'
            ? 'open'
            : input.action === 'finalize'
              ? 'closed'
              : 'finalized';
        if (plan.status !== expectedStatus)
          throw new RideRepositoryConflictError(
            input.action === 'reopen'
              ? '公開済みの送迎予定だけ再編集を開始できます。'
              : '送迎予定の現在状態では、この状態変更を実行できません。',
          );
        if (input.action === 'finalize') {
          const incompleteRows = await tx.$queryRaw<Array<{ count: number }>>`
            SELECT COUNT(*)::int AS count
              FROM ride_requests
             WHERE tenant_id = ${actor.tenantId}::uuid
               AND plan_id = ${plan.id}::uuid
               AND status IN ('pending'::ride_request_status, 'unassigned'::ride_request_status)
          `;
          if ((incompleteRows[0]?.count ?? 0) > 0)
            throw new RideRepositoryConflictError(
              '未割当の乗車希望があるため、送迎を確定できません。',
              'RIDE_FINALIZE_BLOCKED',
            );
          const duplicateMemberRows = await tx.$queryRaw<
            Array<{ member_id: string }>
          >`
            SELECT r.member_id
              FROM ride_assignments a
              JOIN ride_requests r
                ON r.tenant_id = a.tenant_id AND r.id = a.request_id
             WHERE a.tenant_id = ${actor.tenantId}::uuid
               AND a.plan_id = ${plan.id}::uuid
             GROUP BY r.member_id
            HAVING COUNT(*) > 1
             LIMIT 1
          `;
          if (duplicateMemberRows[0])
            throw new RideRepositoryConflictError(
              '同じ部員が重複して割り当てられているため、送迎を確定できません。',
              'RIDE_FINALIZE_BLOCKED',
            );
          const invalidAssignmentRows = await tx.$queryRaw<
            Array<{ id: string }>
          >`
            SELECT o.id
              FROM ride_offers o
              JOIN ride_assignments a
                ON a.tenant_id = o.tenant_id
               AND a.offer_id = o.id
               AND a.plan_id = o.plan_id
             WHERE o.tenant_id = ${actor.tenantId}::uuid
               AND o.plan_id = ${plan.id}::uuid
             GROUP BY o.id, o.capacity, o.status
            HAVING o.status <> 'open'::ride_offer_status
                OR COALESCE(SUM(a.passenger_count), 0) > o.capacity
             LIMIT 1
          `;
          if (invalidAssignmentRows[0])
            throw new RideRepositoryConflictError(
              '割当内容を確認してから、送迎を確定してください。',
              'RIDE_FINALIZE_BLOCKED',
            );
        }
        if (input.action === 'reopen')
          await tx.$executeRaw`
            SELECT set_config('app.ride_reopen_reason', ${input.reasonCode}, true)
          `;
        const rows = await tx.$queryRaw<PlanRow[]>`
          UPDATE ride_plans
             SET status = ${targetStatus}::ride_plan_status
           WHERE tenant_id = ${actor.tenantId}::uuid
             AND id = ${plan.id}::uuid
           RETURNING id, tenant_id, title, departure_at, status, created_at
        `;
        const row = rows[0];
        if (!row)
          throw new RideRepositoryConflictError('送迎予定を変更できません。');
        const planRows = await tx.$queryRaw<PlanRow[]>`
          SELECT id, tenant_id, title, departure_at, pickup_maps_url,
                 destination_maps_url, status, created_at
            FROM app_ride_plan_row(
              ${actor.tenantId}::uuid,
              ${plan.id}::uuid
            )
        `;
        const updated = toPlan(planRows[0] ?? row);
        if (input.action !== 'reopen')
          await appendAudit(tx, actor, {
            action:
              input.action === 'close'
                ? 'ride.plan.close'
                : 'ride.plan.finalize',
            resourceId: updated.id,
            metadata: {
              fromStatus: plan.status,
              toStatus: updated.status,
            },
          });
        return updated;
      });
    },
  };
}

export function calculateRideMetricsFromSnapshot(
  snapshot: RideSnapshot,
): RideMetrics {
  return calculateRideMetrics(snapshot);
}
