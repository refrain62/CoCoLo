import type {
  RideAssignmentInput,
  RideOfferCreateInput,
  RidePlanCreateInput,
  RideRequestCreateInput,
} from '@cocolo/contracts/ride';
import {
  getStoredSelectedTeamId,
  selectedTeamHeaderName,
} from '../auth-team-selection/selected-team-storage.js';

export type RidePlan = {
  id: string;
  tenantId: string;
  title: string;
  departureAt: string;
  pickupMapsUrl: string | null;
  destinationMapsUrl: string | null;
  status: 'draft' | 'open' | 'closed' | 'finalized';
  createdAt: string;
};

export type RideSnapshot = {
  plan: RidePlan;
  offers: Array<{
    id: string;
    capacity: number;
    status: 'open' | 'cancelled';
    isMine: boolean;
  }>;
  requests: Array<{
    id: string;
    memberId: string;
    passengerCount: number;
    status: 'pending' | 'assigned' | 'unassigned' | 'cancelled';
    isMine: boolean;
  }>;
  assignments: Array<{
    id: string;
    requestId: string;
    offerId: string;
    passengerCount: number;
  }>;
  history: Array<{
    id: string;
    action:
      | 'plan_created'
      | 'offer_registered'
      | 'request_registered'
      | 'matching_executed'
      | 'assignment_updated'
      | 'other';
    createdAt: string;
  }>;
};

export type RideDispatch = {
  plan: RidePlan;
  offers: Array<{
    id: string;
    planId: string;
    driverUserId: string;
    capacity: number;
    status: 'open' | 'cancelled';
    createdAt: string;
  }>;
  requests: Array<{
    id: string;
    planId: string;
    memberId: string;
    requesterUserId: string;
    passengerCount: number;
    status: 'pending' | 'assigned' | 'unassigned' | 'cancelled';
    createdAt: string;
  }>;
  assignments: Array<{
    id: string;
    planId: string;
    requestId: string;
    offerId: string;
    passengerCount: number;
    createdAt: string;
  }>;
  history: RideSnapshot['history'];
};

export type RideMetrics = {
  offerCount: number;
  totalCapacity: number;
  requestCount: number;
  requestedSeats: number;
  assignedSeats: number;
  unassignedSeats: number;
  assignmentRate: number;
};

type RideApiOptions = {
  baseUrl?: string;
  getAccessToken?: () => string | null;
  getSelectedTeamId?: () => string | null;
};

type RideErrorBody = {
  error?: { code?: string; message?: string };
};

export class RideApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RideApiError';
  }
}

export type RideOperationsApi = {
  createPlan: (input: RidePlanCreateInput) => Promise<RidePlan>;
  getSnapshot: (planId: string) => Promise<RideSnapshot>;
  createOffer: (
    planId: string,
    input: RideOfferCreateInput,
  ) => Promise<RideSnapshot['offers'][number]>;
  createRequest: (
    planId: string,
    input: RideRequestCreateInput,
  ) => Promise<RideSnapshot['requests'][number]>;
  autoMatch: (planId: string) => Promise<{
    assignments: RideDispatch['assignments'];
    unassignedRequestIds: string[];
  }>;
  assign: (
    planId: string,
    input: RideAssignmentInput,
  ) => Promise<RideDispatch['assignments'][number]>;
  getDispatch: (planId: string) => Promise<RideDispatch>;
  getMetrics: (planId: string) => Promise<RideMetrics>;
};

function getStoredAccessToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('cocolo.accessToken');
}

async function readError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as RideErrorBody;
  return new RideApiError(
    response.status,
    body.error?.code ?? 'REQUEST_FAILED',
    body.error?.message ?? '通信に失敗しました。',
  );
}

// 送迎APIのBearer付与と共通エラー変換を集約し、画面ごとの認証実装の揺れを防ぐ。
export function createRideOperationsApi({
  baseUrl = import.meta.env.VITE_API_URL ?? '',
  getAccessToken = getStoredAccessToken,
  getSelectedTeamId = getStoredSelectedTeamId,
}: RideApiOptions = {}): RideOperationsApi {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const accessToken = getAccessToken();
    if (!accessToken)
      throw new RideApiError(401, 'UNAUTHENTICATED', 'ログインが必要です。');
    const selectedTeamId = getSelectedTeamId();
    const response = await fetch(`${baseUrl}/api/v1/ride-plans${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(selectedTeamId ? { [selectedTeamHeaderName]: selectedTeamId } : {}),
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) throw await readError(response);
    return (await response.json()) as T;
  }

  const planPath = (planId: string) => `/${encodeURIComponent(planId)}`;

  return {
    async createPlan(input) {
      const response = await request<{ data: RidePlan }>('', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return response.data;
    },
    async getSnapshot(planId) {
      const response = await request<{ data: RideSnapshot }>(planPath(planId));
      return response.data;
    },
    async createOffer(planId, input) {
      const response = await request<{ data: RideSnapshot['offers'][number] }>(
        `${planPath(planId)}/offers`,
        { method: 'POST', body: JSON.stringify(input) },
      );
      return response.data;
    },
    async createRequest(planId, input) {
      const response = await request<{
        data: RideSnapshot['requests'][number];
      }>(`${planPath(planId)}/requests`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return response.data;
    },
    async autoMatch(planId) {
      const response = await request<{
        data: {
          assignments: RideDispatch['assignments'];
          unassignedRequestIds: string[];
        };
      }>(`${planPath(planId)}/match`, { method: 'POST', body: '{}' });
      return response.data;
    },
    async assign(planId, input) {
      const response = await request<{
        data: RideDispatch['assignments'][number];
      }>(`${planPath(planId)}/assignments`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return response.data;
    },
    async getDispatch(planId) {
      const response = await request<{ data: RideDispatch }>(
        `${planPath(planId)}/dispatch`,
      );
      return response.data;
    },
    async getMetrics(planId) {
      const response = await request<{ data: RideMetrics }>(
        `${planPath(planId)}/metrics`,
      );
      return response.data;
    },
  };
}
