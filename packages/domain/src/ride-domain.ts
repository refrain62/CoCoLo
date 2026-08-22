export type RidePlanStatus = 'draft' | 'open' | 'closed' | 'finalized';
export type RideOfferStatus = 'open' | 'cancelled';
export type RideRequestStatus =
  | 'pending'
  | 'assigned'
  | 'unassigned'
  | 'cancelled';

export type RidePlan = {
  id: string;
  tenantId: string;
  title: string;
  departureAt: string;
  pickupMapsUrl: string | null;
  destinationMapsUrl: string | null;
  status: RidePlanStatus;
  createdAt: string;
};

export type RideOffer = {
  id: string;
  planId: string;
  driverUserId: string;
  capacity: number;
  status: RideOfferStatus;
  createdAt: string;
};

export type RideRequest = {
  id: string;
  planId: string;
  memberId: string;
  requesterUserId: string;
  passengerCount: number;
  status: RideRequestStatus;
  createdAt: string;
};

export type RideAssignment = {
  id: string;
  planId: string;
  requestId: string;
  offerId: string;
  passengerCount: number;
  createdAt: string;
};

export type RideSnapshot = {
  plan: RidePlan;
  offers: RideOffer[];
  requests: RideRequest[];
  assignments: RideAssignment[];
};

export type RideMatchDecision = {
  requestId: string;
  offerId: string;
  passengerCount: number;
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

export class RideValidationError extends Error {
  readonly code = 'RIDE_VALIDATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'RideValidationError';
  }
}

export class RideCapacityError extends Error {
  readonly code = 'RIDE_CAPACITY_EXCEEDED';

  constructor() {
    super('乗車可能数を超える割当はできません。');
    this.name = 'RideCapacityError';
  }
}

// Google Mapsへの遷移先を許可ホストとパスに限定し、任意サイトへのリダイレクトや危険なschemeを受け付けない。
export function validateGoogleMapsUrl(value: string | null | undefined) {
  if (value == null || value.trim() === '') return null;

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new RideValidationError('Google MapsのURL形式が不正です。');
  }

  const hostname = url.hostname.toLowerCase();
  const isAllowedHost =
    hostname === 'www.google.com' || hostname === 'maps.google.com';
  const isMapsPath =
    hostname === 'maps.google.com' ||
    url.pathname === '/maps' ||
    url.pathname.startsWith('/maps/');
  if (
    url.protocol !== 'https:' ||
    !isAllowedHost ||
    !isMapsPath ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.hash !== ''
  )
    throw new RideValidationError(
      'Google MapsのHTTPSリンクだけを登録できます。',
    );

  return url.toString();
}

// 車ごとの残席を計算し、作成順の希望を一つの車へ割り当てる。希望を分割しないため、定員超過は未割当として残す。
export function matchRideRequests(input: {
  offers: RideOffer[];
  requests: RideRequest[];
  assignments: RideAssignment[];
}): RideMatchDecision[] {
  const remaining = new Map<string, number>();
  for (const offer of input.offers) {
    if (offer.status === 'open') remaining.set(offer.id, offer.capacity);
  }
  for (const assignment of input.assignments) {
    const seats = remaining.get(assignment.offerId);
    if (seats !== undefined)
      remaining.set(assignment.offerId, seats - assignment.passengerCount);
  }

  const sortedRequests = input.requests
    .filter(
      (request) =>
        (request.status === 'pending' || request.status === 'unassigned') &&
        !input.assignments.some(
          (assignment) => assignment.requestId === request.id,
        ),
    )
    .sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.id.localeCompare(right.id)
        : left.createdAt.localeCompare(right.createdAt),
    );
  const sortedOffers = input.offers
    .filter((offer) => offer.status === 'open')
    .sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.id.localeCompare(right.id)
        : left.createdAt.localeCompare(right.createdAt),
    );
  const decisions: RideMatchDecision[] = [];
  for (const request of sortedRequests) {
    const offer = sortedOffers.find(
      (candidate) =>
        (remaining.get(candidate.id) ?? 0) >= request.passengerCount,
    );
    if (!offer) continue;
    const seats = remaining.get(offer.id) ?? 0;
    remaining.set(offer.id, seats - request.passengerCount);
    decisions.push({
      requestId: request.id,
      offerId: offer.id,
      passengerCount: request.passengerCount,
    });
  }
  return decisions;
}

// 手動割当の前に既存割当と要求人数を突き合わせ、同時実行でもrepositoryが同じ不変条件を再確認できる形にする。
export function assertCapacity(input: {
  capacity: number;
  assignedSeats: number;
  requestedSeats: number;
}) {
  if (
    input.capacity < 1 ||
    input.requestedSeats < 1 ||
    input.assignedSeats < 0 ||
    input.assignedSeats + input.requestedSeats > input.capacity
  )
    throw new RideCapacityError();
}

// 個人を含まない集計値だけを算出し、運用監視へ渡しても乗車者情報が複製されないようにする。
export function calculateRideMetrics(snapshot: RideSnapshot): RideMetrics {
  const activeOffers = snapshot.offers.filter(
    (offer) => offer.status === 'open',
  );
  const activeRequests = snapshot.requests.filter(
    (request) => request.status !== 'cancelled',
  );
  const requestedSeats = activeRequests.reduce(
    (total, request) => total + request.passengerCount,
    0,
  );
  const assignedSeats = snapshot.assignments.reduce(
    (total, assignment) => total + assignment.passengerCount,
    0,
  );
  const unassignedSeats = Math.max(requestedSeats - assignedSeats, 0);
  return {
    offerCount: activeOffers.length,
    totalCapacity: activeOffers.reduce(
      (total, offer) => total + offer.capacity,
      0,
    ),
    requestCount: activeRequests.length,
    requestedSeats,
    assignedSeats,
    unassignedSeats,
    assignmentRate:
      requestedSeats === 0
        ? 1
        : Number((assignedSeats / requestedSeats).toFixed(4)),
  };
}
