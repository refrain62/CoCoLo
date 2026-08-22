import type { z } from 'zod';
import {
  rideAssignmentSchema,
  rideMatchSchema,
  rideOfferCreateSchema,
  ridePlanCreateSchema,
  ridePlanIdSchema,
  rideRequestCreateSchema,
} from './ride-contract.mjs';

export {
  rideAssignmentSchema,
  rideMatchSchema,
  rideOfferCreateSchema,
  ridePlanCreateSchema,
  ridePlanIdSchema,
  rideRequestCreateSchema,
};

export type RidePlanCreateInput = z.infer<typeof ridePlanCreateSchema>;
export type RideOfferCreateInput = z.infer<typeof rideOfferCreateSchema>;
export type RideRequestCreateInput = z.infer<typeof rideRequestCreateSchema>;
export type RideAssignmentInput = z.infer<typeof rideAssignmentSchema>;
export type RideMatchInput = z.infer<typeof rideMatchSchema>;
export type RidePlanId = z.infer<typeof ridePlanIdSchema>;
