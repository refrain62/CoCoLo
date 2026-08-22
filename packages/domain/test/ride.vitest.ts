import { describe, expect, it } from 'vitest';
import {
  assertCapacity,
  calculateRideMetrics,
  matchRideRequests,
  RideCapacityError,
  validateGoogleMapsUrl,
} from '../src/ride-domain.js';

const plan = {
  id: 'plan-1',
  tenantId: 'tenant-1',
  title: '練習試合',
  departureAt: '2026-08-23T08:00:00.000Z',
  pickupMapsUrl: null,
  destinationMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Tokyo',
  status: 'open' as const,
  createdAt: '2026-08-22T00:00:00.000Z',
};

describe('送迎ドメイン', () => {
  it('車の作成順と希望の作成順を固定して割り当てる', () => {
    expect(
      matchRideRequests({
        offers: [
          {
            id: 'offer-1',
            planId: 'plan-1',
            driverUserId: 'driver-1',
            capacity: 2,
            status: 'open',
            createdAt: '2026-08-22T00:00:00.000Z',
          },
        ],
        requests: [
          {
            id: 'request-1',
            planId: 'plan-1',
            memberId: 'member-1',
            requesterUserId: 'guardian-1',
            passengerCount: 2,
            status: 'pending',
            createdAt: '2026-08-22T00:01:00.000Z',
          },
          {
            id: 'request-2',
            planId: 'plan-1',
            memberId: 'member-2',
            requesterUserId: 'guardian-2',
            passengerCount: 1,
            status: 'pending',
            createdAt: '2026-08-22T00:02:00.000Z',
          },
        ],
        assignments: [],
      }),
    ).toEqual([
      { requestId: 'request-1', offerId: 'offer-1', passengerCount: 2 },
    ]);
  });

  it('既存割当を差し引いて定員超過を拒否する', () => {
    expect(() =>
      assertCapacity({ capacity: 3, assignedSeats: 2, requestedSeats: 2 }),
    ).toThrow(RideCapacityError);
  });

  it('Google Maps以外のホスト、HTTP、認証情報、fragmentを拒否する', () => {
    expect(() => validateGoogleMapsUrl('https://example.com/maps')).toThrow();
    expect(() =>
      validateGoogleMapsUrl('http://www.google.com/maps/search/?api=1'),
    ).toThrow();
    expect(() =>
      validateGoogleMapsUrl('https://user:pass@www.google.com/maps'),
    ).toThrow();
    expect(() =>
      validateGoogleMapsUrl('https://www.google.com/maps#private'),
    ).toThrow();
  });

  it('メトリクスは個人識別子を含めず席数だけを集計する', () => {
    expect(
      calculateRideMetrics({
        plan,
        offers: [
          {
            id: 'offer-1',
            planId: 'plan-1',
            driverUserId: 'driver-1',
            capacity: 3,
            status: 'open',
            createdAt: '2026-08-22T00:00:00.000Z',
          },
        ],
        requests: [
          {
            id: 'request-1',
            planId: 'plan-1',
            memberId: 'member-1',
            requesterUserId: 'guardian-1',
            passengerCount: 2,
            status: 'assigned',
            createdAt: '2026-08-22T00:01:00.000Z',
          },
          {
            id: 'request-2',
            planId: 'plan-1',
            memberId: 'member-2',
            requesterUserId: 'guardian-2',
            passengerCount: 1,
            status: 'unassigned',
            createdAt: '2026-08-22T00:02:00.000Z',
          },
        ],
        assignments: [
          {
            id: 'assignment-1',
            planId: 'plan-1',
            requestId: 'request-1',
            offerId: 'offer-1',
            passengerCount: 2,
            createdAt: '2026-08-22T00:03:00.000Z',
          },
        ],
      }),
    ).toEqual({
      offerCount: 1,
      totalCapacity: 3,
      requestCount: 2,
      requestedSeats: 3,
      assignedSeats: 2,
      unassignedSeats: 1,
      assignmentRate: 0.6667,
    });
  });
});
