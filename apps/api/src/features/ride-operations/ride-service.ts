import type {
  RideActor,
  RideAssignmentInput,
  RideOfferCreateInput,
  RidePlanCreateInput,
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

export type RideSnapshotView = {
  plan: RideSnapshot['plan'];
  offers: Array<{
    id: string;
    capacity: number;
    status: RideSnapshot['offers'][number]['status'];
    isMine: boolean;
  }>;
  requests: Array<{
    id: string;
    memberId: string;
    passengerCount: number;
    status: RideSnapshot['requests'][number]['status'];
    isMine: boolean;
  }>;
  assignments: Array<{
    id: string;
    requestId: string;
    offerId: string;
    passengerCount: number;
  }>;
  history: RideSnapshot['history'];
};

export type RideDispatchView = {
  plan: RidePlan;
  offers: RideSnapshot['offers'];
  requests: RideSnapshot['requests'];
  assignments: RideSnapshot['assignments'];
};

export type RideService = {
  listPlans: (actor: RideActor) => Promise<RidePlan[]>;
  createPlan: (
    actor: RideActor,
    input: RidePlanCreateInput,
  ) => Promise<RidePlan>;
  createOffer: (
    actor: RideActor,
    planId: string,
    input: RideOfferCreateInput,
  ) => Promise<RideSnapshot['offers'][number]>;
  createRequest: (
    actor: RideActor,
    planId: string,
    input: RideRequestCreateInput,
  ) => Promise<RideSnapshot['requests'][number]>;
  getSnapshot: (actor: RideActor, planId: string) => Promise<RideSnapshotView>;
  autoMatch: (
    actor: RideActor,
    planId: string,
  ) => ReturnType<RideRepository['autoMatch']>;
  assign: (
    actor: RideActor,
    planId: string,
    input: RideAssignmentInput,
  ) => ReturnType<RideRepository['assign']>;
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

function toSnapshotView(
  actor: RideActor,
  snapshot: RideSnapshot,
): RideSnapshotView {
  return {
    plan: snapshot.plan,
    offers: snapshot.offers.map((offer) => ({
      id: offer.id,
      capacity: offer.capacity,
      status: offer.status,
      isMine: offer.driverUserId === actor.userId,
    })),
    requests: snapshot.requests.map((request) => ({
      id: request.id,
      memberId: request.memberId,
      passengerCount: request.passengerCount,
      status: request.status,
      isMine: request.requesterUserId === actor.userId,
    })),
    assignments: snapshot.assignments.map((assignment) => ({
      id: assignment.id,
      requestId: assignment.requestId,
      offerId: assignment.offerId,
      passengerCount: assignment.passengerCount,
    })),
    history: snapshot.history,
  };
}

// 送迎機能の認可・入力正規化をserviceへ集約し、API handlerやWeb表示が権限境界を迂回できないようにする。
export function createRideService(repository: RideRepository): RideService {
  return {
    listPlans: (actor) => repository.listPlans(actor),
    createPlan: (actor, input) => {
      assertManager(actor);
      return repository.createPlan(actor, validatePlanInput(input));
    },
    createOffer: (actor, planId, input) =>
      repository.createOffer(actor, planId, input),
    createRequest: (actor, planId, input) =>
      repository.createRequest(actor, planId, input),
    async getSnapshot(actor, planId) {
      return toSnapshotView(actor, await repository.getSnapshot(actor, planId));
    },
    async autoMatch(actor, planId) {
      assertManager(actor);
      return repository.autoMatch(actor, planId);
    },
    async assign(actor, planId, input) {
      assertManager(actor);
      return repository.assign(actor, planId, input);
    },
    async getDispatch(actor, planId) {
      assertManager(actor);
      return repository.getSnapshot(actor, planId);
    },
    async getMetrics(actor, planId) {
      assertManager(actor);
      return calculateRideMetrics(await repository.getSnapshot(actor, planId));
    },
  };
}
