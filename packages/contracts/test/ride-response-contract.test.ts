import assert from 'node:assert/strict';
import test from 'node:test';
import {
  rideDispatchResponseEnvelopeSchema,
  rideMatchResponseSchema,
  rideMetricsResponseEnvelopeSchema,
  ridePlanListResponseSchema,
  rideSnapshotResponseEnvelopeSchema,
} from '../src/ride-response-contract.ts';

const plan = {
  id: '00000000-0000-7000-8000-000000000501',
  title: '練習試合',
  departureAt: '2026-08-24T08:00:00.000Z',
  pickupMapsUrl: null,
  destinationMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Tokyo',
  status: 'open' as const,
  createdAt: '2026-08-23T00:00:00.000Z',
};

const assignment = {
  id: '00000000-0000-7000-8000-000000000504',
  planId: plan.id,
  requestId: '00000000-0000-7000-8000-000000000505',
  offerId: '00000000-0000-7000-8000-000000000506',
  passengerCount: 2,
  createdAt: '2026-08-24T00:00:00.000Z',
};

const snapshotAssignment = {
  id: assignment.id,
  requestId: assignment.requestId,
  offerId: assignment.offerId,
  passengerCount: assignment.passengerCount,
};

test('送迎plan responseはtenantIdを公開せず、項目を固定する', () => {
  assert.equal(
    ridePlanListResponseSchema.safeParse({ data: [plan] }).success,
    true,
  );
  assert.equal(
    ridePlanListResponseSchema.safeParse({
      data: [{ ...plan, tenantId: 'tenant-a' }],
    }).success,
    false,
  );
});

test('送迎snapshot responseは操作者IDを公開しない', () => {
  assert.equal(
    rideSnapshotResponseEnvelopeSchema.safeParse({
      data: {
        plan,
        offers: [
          {
            id: '00000000-0000-7000-8000-000000000502',
            capacity: 4,
            status: 'open',
            isMine: true,
          },
        ],
        requests: [
          {
            id: '00000000-0000-7000-8000-000000000503',
            memberId: '00000000-0000-7000-8000-000000000507',
            passengerCount: 2,
            status: 'assigned',
            isMine: false,
          },
        ],
        assignments: [snapshotAssignment],
        confirmedAssignments: [],
        history: [],
      },
    }).success,
    true,
  );
  assert.equal(
    rideSnapshotResponseEnvelopeSchema.safeParse({
      data: {
        plan,
        offers: [
          {
            id: '00000000-0000-7000-8000-000000000502',
            capacity: 4,
            status: 'open',
            isMine: true,
            driverUserId: 'driver-a',
          },
        ],
        requests: [],
        assignments: [],
        confirmedAssignments: [],
        history: [],
      },
    }).success,
    false,
  );
});

test('送迎snapshotの確定公開投影は表示名だけを含み、長さを固定する', () => {
  const confirmedAssignment = {
    ...snapshotAssignment,
    memberName: '山田 花子',
    driverName: '佐藤 太郎',
  };
  assert.equal(
    rideSnapshotResponseEnvelopeSchema.safeParse({
      data: {
        plan: { ...plan, status: 'finalized' },
        offers: [],
        requests: [],
        assignments: [],
        confirmedAssignments: [confirmedAssignment],
        history: [],
      },
    }).success,
    true,
  );
  assert.equal(
    rideSnapshotResponseEnvelopeSchema.safeParse({
      data: {
        plan: { ...plan, status: 'finalized' },
        offers: [],
        requests: [],
        assignments: [],
        confirmedAssignments: [
          { ...confirmedAssignment, driverUserId: 'driver-a' },
        ],
        history: [],
      },
    }).success,
    false,
  );
  assert.equal(
    rideSnapshotResponseEnvelopeSchema.safeParse({
      data: {
        plan: { ...plan, status: 'finalized' },
        offers: [],
        requests: [],
        assignments: [],
        confirmedAssignments: [{ ...confirmedAssignment, memberName: '' }],
        history: [],
      },
    }).success,
    false,
  );
  assert.equal(
    rideSnapshotResponseEnvelopeSchema.safeParse({
      data: {
        plan: { ...plan, status: 'finalized' },
        offers: [],
        requests: [],
        assignments: [],
        confirmedAssignments: [
          { ...confirmedAssignment, driverName: 'あ'.repeat(201) },
        ],
        history: [],
      },
    }).success,
    false,
  );
});

test('送迎dispatch responseは管理者向け識別子を許可し、tenantIdは拒否する', () => {
  const result = {
    data: {
      plan,
      offers: [
        {
          id: '00000000-0000-7000-8000-000000000502',
          planId: plan.id,
          driverUserId: 'driver-a',
          capacity: 4,
          status: 'open',
          createdAt: '2026-08-24T00:00:00.000Z',
        },
      ],
      requests: [
        {
          id: '00000000-0000-7000-8000-000000000503',
          planId: plan.id,
          memberId: '00000000-0000-7000-8000-000000000507',
          requesterUserId: 'guardian-a',
          passengerCount: 2,
          status: 'assigned',
          createdAt: '2026-08-24T00:00:00.000Z',
        },
      ],
      assignments: [assignment],
      history: [],
    },
  };
  assert.equal(
    rideDispatchResponseEnvelopeSchema.safeParse(result).success,
    true,
  );
  assert.equal(
    rideDispatchResponseEnvelopeSchema.safeParse({
      data: { ...result.data, tenantId: 'tenant-a' },
    }).success,
    false,
  );
});

test('送迎matchとmetrics responseは件数・集計値を固定する', () => {
  assert.equal(
    rideMatchResponseSchema.safeParse({
      data: { assignments: [assignment], unassignedRequestIds: [] },
    }).success,
    true,
  );
  assert.equal(
    rideMetricsResponseEnvelopeSchema.safeParse({
      data: {
        offerCount: 1,
        totalCapacity: 4,
        requestCount: 1,
        requestedSeats: 2,
        assignedSeats: 2,
        unassignedSeats: 0,
        assignmentRate: 1,
      },
    }).success,
    true,
  );
});
