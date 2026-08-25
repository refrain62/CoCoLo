import type {
  RideActor,
  RideAssignmentInput,
  RideOfferCreateInput,
  RidePlanCreateInput,
  RidePlanTransitionInput,
  RideRepository,
  RideRequestCreateInput,
} from '@cocolo/db/ride';
import {
  calculateRideMetrics,
  type RideMetrics,
  type RidePlan,
  type RideSnapshot,
  validateGoogleMapsUrl,
} from '@cocolo/domain/ride';

export type { RideActor };

export type RidePlanView = Omit<RidePlan, 'tenantId'>;

export type RideOfferView = {
  id: string;
  capacity: number;
  status: RideSnapshot['offers'][number]['status'];
  isMine: boolean;
};

export type RideRequestView = {
  id: string;
  memberId: string;
  passengerCount: number;
  status: RideSnapshot['requests'][number]['status'];
  isMine: boolean;
};

export type RideAssignmentView = RideSnapshot['assignments'][number];

export type RideSnapshotAssignmentView = {
  id: string;
  requestId: string;
  offerId: string;
  passengerCount: number;
};

export type RideSnapshotView = {
  plan: RidePlanView;
  offers: RideOfferView[];
  requests: RideRequestView[];
  assignments: RideSnapshotAssignmentView[];
  history: RideSnapshot['history'];
};

export type RideDispatchView = {
  plan: RidePlanView;
  offers: RideSnapshot['offers'];
  requests: RideSnapshot['requests'];
  assignments: RideSnapshot['assignments'];
};

export type RideService = {
  listPlans: (actor: RideActor) => Promise<RidePlanView[]>;
  createPlan: (
    actor: RideActor,
    input: RidePlanCreateInput,
  ) => Promise<RidePlanView>;
  createOffer: (
    actor: RideActor,
    planId: string,
    input: RideOfferCreateInput,
  ) => Promise<RideOfferView>;
  createRequest: (
    actor: RideActor,
    planId: string,
    input: RideRequestCreateInput,
  ) => Promise<RideRequestView>;
  getSnapshot: (actor: RideActor, planId: string) => Promise<RideSnapshotView>;
  autoMatch: (
    actor: RideActor,
    planId: string,
  ) => Promise<{
    assignments: RideAssignmentView[];
    unassignedRequestIds: string[];
  }>;
  assign: (
    actor: RideActor,
    planId: string,
    input: RideAssignmentInput,
  ) => Promise<RideAssignmentView>;
  transitionPlan: (
    actor: RideActor,
    planId: string,
    input: RidePlanTransitionInput,
  ) => Promise<RidePlanView>;
  getDispatch: (actor: RideActor, planId: string) => Promise<RideDispatchView>;
  getMetrics: (actor: RideActor, planId: string) => Promise<RideMetrics>;
};

const managerRoles = new Set<RideActor['role']>(['owner', 'admin', 'staff']);

function assertManager(actor: RideActor) {
  if (!managerRoles.has(actor.role)) {
    const error = new Error('送迎の管理権限がありません。');
    Object.assign(error, { status: 403, code: 'FORBIDDEN' });
    throw error;
  }
}

// Web/APIの入力をrepositoryへ渡す前にもMapsの許可範囲を確認し、別経路からの呼び出しでも危険なリンクを保存しない。
function validatePlanInput(input: RidePlanCreateInput) {
  return {
    ...input,
    title: input.title.trim(),
    pickupMapsUrl: validateGoogleMapsUrl(input.pickupMapsUrl),
    destinationMapsUrl: validateGoogleMapsUrl(input.destinationMapsUrl),
  };
}

function toPlanView(plan: RidePlan): RidePlanView {
  const { tenantId: _tenantId, ...view } = plan;
  return view;
}

function toOfferView(
  actor: RideActor,
  offer: RideSnapshot['offers'][number],
): RideOfferView {
  return {
    id: offer.id,
    capacity: offer.capacity,
    status: offer.status,
    isMine: offer.driverUserId === actor.userId,
  };
}

function toRequestView(
  actor: RideActor,
  request: RideSnapshot['requests'][number],
): RideRequestView {
  return {
    id: request.id,
    memberId: request.memberId,
    passengerCount: request.passengerCount,
    status: request.status,
    isMine: request.requesterUserId === actor.userId,
  };
}

function toAssignmentView(
  assignment: RideSnapshot['assignments'][number],
): RideAssignmentView {
  return { ...assignment };
}

function toSnapshotAssignmentView(
  assignment: RideSnapshot['assignments'][number],
): RideSnapshotAssignmentView {
  return {
    id: assignment.id,
    requestId: assignment.requestId,
    offerId: assignment.offerId,
    passengerCount: assignment.passengerCount,
  };
}

function toSnapshotView(
  actor: RideActor,
  snapshot: RideSnapshot,
): RideSnapshotView {
  return {
    plan: toPlanView(snapshot.plan),
    offers: snapshot.offers.map((offer) => toOfferView(actor, offer)),
    requests: snapshot.requests.map((request) => toRequestView(actor, request)),
    assignments: snapshot.assignments.map(toSnapshotAssignmentView),
    history: snapshot.history,
  };
}

// 送迎機能の認可・入力正規化をserviceへ集約し、API handlerやWeb表示が権限境界を迂回できないようにする。
export function createRideService(repository: RideRepository): RideService {
  return {
    async listPlans(actor) {
      return (await repository.listPlans(actor)).map(toPlanView);
    },
    async createPlan(actor, input) {
      assertManager(actor);
      return toPlanView(
        await repository.createPlan(actor, validatePlanInput(input)),
      );
    },
    async createOffer(actor, planId, input) {
      return toOfferView(
        actor,
        await repository.createOffer(actor, planId, input),
      );
    },
    async createRequest(actor, planId, input) {
      return toRequestView(
        actor,
        await repository.createRequest(actor, planId, input),
      );
    },
    async getSnapshot(actor, planId) {
      return toSnapshotView(actor, await repository.getSnapshot(actor, planId));
    },
    async autoMatch(actor, planId) {
      assertManager(actor);
      const result = await repository.autoMatch(actor, planId);
      return {
        assignments: result.assignments.map(toAssignmentView),
        unassignedRequestIds: result.unassignedRequestIds,
      };
    },
    async assign(actor, planId, input) {
      assertManager(actor);
      return toAssignmentView(await repository.assign(actor, planId, input));
    },
    async transitionPlan(actor, planId, input) {
      assertManager(actor);
      return toPlanView(await repository.transitionPlan(actor, planId, input));
    },
    async getDispatch(actor, planId) {
      assertManager(actor);
      const snapshot = await repository.getSnapshot(actor, planId);
      return {
        plan: toPlanView(snapshot.plan),
        offers: snapshot.offers,
        requests: snapshot.requests,
        assignments: snapshot.assignments,
        history: snapshot.history,
      };
    },
    async getMetrics(actor, planId) {
      assertManager(actor);
      return calculateRideMetrics(await repository.getSnapshot(actor, planId));
    },
  };
}
