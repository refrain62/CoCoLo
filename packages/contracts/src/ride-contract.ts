import { z } from 'zod';
import {
  requireExactlyOneSubjectMemberId,
  subjectMemberIdFields,
} from './subject-member.ts';

const uuid = z.string().uuid();
const mapsUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowedHost = host === 'www.google.com' || host === 'maps.google.com';
    const mapsPath =
      host === 'maps.google.com' ||
      url.pathname === '/maps' ||
      url.pathname.startsWith('/maps/');
    return url.protocol === 'https:' && allowedHost && mapsPath;
  }, 'Google MapsのHTTPS URLだけを指定してください。');

// API境界で件数・文字数・日時の上限を固定し、容量超過や巨大入力をdomainへ渡さない。
export const ridePlanCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    departureAt: z.string().datetime({ offset: true }),
    pickupMapsUrl: mapsUrl.nullable().optional(),
    destinationMapsUrl: mapsUrl.nullable().optional(),
  })
  .strict();

export const ridePlanUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    departureAt: z.string().datetime({ offset: true }).optional(),
    pickupMapsUrl: mapsUrl.nullable().optional(),
    destinationMapsUrl: mapsUrl.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: '変更項目を1つ以上指定してください。',
  });

export const rideOfferCreateSchema = z
  .object({
    capacity: z.number().int().min(1).max(20),
    driverDisplayName: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const rideRequestCreateSchema = z
  .object({
    ...subjectMemberIdFields,
    passengerCount: z.number().int().min(1).max(8).default(1),
  })
  .strict()
  .superRefine(requireExactlyOneSubjectMemberId);

export const rideAssignmentSchema = z
  .object({
    requestId: uuid,
    offerId: uuid,
    expectedOfferId: uuid.nullable(),
  })
  .strict();

export const rideMatchSchema = z.object({}).strict();

export const ridePlanTransitionSchema = z.union([
  z.object({ action: z.enum(['close', 'finalize']) }).strict(),
  z
    .object({
      action: z.literal('reopen'),
      reasonCode: z.enum([
        'schedule_change',
        'member_change',
        'vehicle_change',
        'other',
      ]),
    })
    .strict(),
]);

export const ridePlanIdSchema = uuid;

export type RidePlanCreateInput = z.infer<typeof ridePlanCreateSchema>;
export type RidePlanUpdateInput = z.infer<typeof ridePlanUpdateSchema>;
export type RideOfferCreateInput = z.infer<typeof rideOfferCreateSchema>;
export type RideRequestCreateInput = z.infer<typeof rideRequestCreateSchema>;
export type RideAssignmentInput = z.infer<typeof rideAssignmentSchema>;
export type RideMatchInput = z.infer<typeof rideMatchSchema>;
export type RidePlanTransitionInput = z.infer<typeof ridePlanTransitionSchema>;
export type RidePlanId = z.infer<typeof ridePlanIdSchema>;
