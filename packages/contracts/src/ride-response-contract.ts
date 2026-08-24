import { z } from 'zod';

const uuid = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });
const mapsUrl = z.string().url().max(2048).nullable();

const ridePlanResponseSchema = z
  .object({
    id: uuid,
    title: z.string().min(1).max(200),
    departureAt: dateTime,
    pickupMapsUrl: mapsUrl,
    destinationMapsUrl: mapsUrl,
    status: z.enum(['draft', 'open', 'closed', 'finalized']),
    createdAt: dateTime,
  })
  .strict();

const rideOfferResponseSchema = z
  .object({
    id: uuid,
    capacity: z.number().int().min(1).max(20),
    status: z.enum(['open', 'cancelled']),
    isMine: z.boolean(),
  })
  .strict();

const rideRequestResponseSchema = z
  .object({
    id: uuid,
    memberId: uuid,
    passengerCount: z.number().int().min(1).max(8),
    status: z.enum(['pending', 'assigned', 'unassigned', 'cancelled']),
    isMine: z.boolean(),
  })
  .strict();

const rideAssignmentResponseSchema = z
  .object({
    id: uuid,
    planId: uuid,
    requestId: uuid,
    offerId: uuid,
    passengerCount: z.number().int().min(1).max(8),
    createdAt: dateTime,
  })
  .strict();

const rideSnapshotAssignmentResponseSchema = z
  .object({
    id: uuid,
    requestId: uuid,
    offerId: uuid,
    passengerCount: z.number().int().min(1).max(8),
  })
  .strict();

const rideHistoryResponseSchema = z
  .object({
    id: z.string().min(1).max(128),
    action: z.enum([
      'plan_created',
      'offer_registered',
      'request_registered',
      'matching_executed',
      'assignment_updated',
      'other',
    ]),
    createdAt: dateTime,
  })
  .strict();

const rideSnapshotResponseSchema = z
  .object({
    plan: ridePlanResponseSchema,
    offers: z.array(rideOfferResponseSchema).max(100),
    requests: z.array(rideRequestResponseSchema).max(100),
    assignments: z.array(rideSnapshotAssignmentResponseSchema).max(100),
    history: z.array(rideHistoryResponseSchema).max(1000),
  })
  .strict();

const rideDispatchOfferResponseSchema = z
  .object({
    id: uuid,
    planId: uuid,
    driverUserId: z.string().min(1).max(128),
    capacity: z.number().int().min(1).max(20),
    status: z.enum(['open', 'cancelled']),
    createdAt: dateTime,
  })
  .strict();

const rideDispatchRequestResponseSchema = z
  .object({
    id: uuid,
    planId: uuid,
    memberId: uuid,
    requesterUserId: z.string().min(1).max(128),
    passengerCount: z.number().int().min(1).max(8),
    status: z.enum(['pending', 'assigned', 'unassigned', 'cancelled']),
    createdAt: dateTime,
  })
  .strict();

const rideDispatchResponseSchema = z
  .object({
    plan: ridePlanResponseSchema,
    offers: z.array(rideDispatchOfferResponseSchema).max(100),
    requests: z.array(rideDispatchRequestResponseSchema).max(100),
    assignments: z.array(rideAssignmentResponseSchema).max(100),
    history: z.array(rideHistoryResponseSchema).max(1000),
  })
  .strict();

const rideMetricsResponseSchema = z
  .object({
    offerCount: z.number().int().min(0).max(100),
    totalCapacity: z.number().int().min(0).max(2000),
    requestCount: z.number().int().min(0).max(100),
    requestedSeats: z.number().int().min(0).max(800),
    assignedSeats: z.number().int().min(0).max(800),
    unassignedSeats: z.number().int().min(0).max(800),
    assignmentRate: z.number().min(0).max(1),
  })
  .strict();

export const ridePlanListResponseSchema = z
  .object({ data: z.array(ridePlanResponseSchema).max(100) })
  .strict();

export const ridePlanResponseEnvelopeSchema = z
  .object({ data: ridePlanResponseSchema })
  .strict();

export const rideSnapshotResponseEnvelopeSchema = z
  .object({ data: rideSnapshotResponseSchema })
  .strict();

export const rideOfferResponseEnvelopeSchema = z
  .object({ data: rideOfferResponseSchema })
  .strict();

export const rideRequestResponseEnvelopeSchema = z
  .object({ data: rideRequestResponseSchema })
  .strict();

export const rideMatchResponseSchema = z
  .object({
    data: z
      .object({
        assignments: z.array(rideAssignmentResponseSchema).max(100),
        unassignedRequestIds: z.array(uuid).max(100),
      })
      .strict(),
  })
  .strict();

export const rideAssignmentResponseEnvelopeSchema = z
  .object({ data: rideAssignmentResponseSchema })
  .strict();

export const rideDispatchResponseEnvelopeSchema = z
  .object({ data: rideDispatchResponseSchema })
  .strict();

export const rideMetricsResponseEnvelopeSchema = z
  .object({ data: rideMetricsResponseSchema })
  .strict();
