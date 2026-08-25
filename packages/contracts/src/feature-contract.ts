import { z } from 'zod';

export const featureKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9._-]{1,63}$/, 'feature keyが不正です。');
export const featureBillingTypeSchema = z.enum(['free', 'paid']);
export const featureAvailabilityReasonSchema = z.enum([
  'default',
  'flag',
  'plan',
  'unavailable',
]);

export const featureFlagUpdateSchema = z
  .object({
    enabled: z.boolean(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const featureContractItemSchema = z
  .object({
    key: featureKeySchema,
    billingType: featureBillingTypeSchema,
    displayName: z.string().trim().min(1).max(200),
    enabled: z.boolean(),
    reason: featureAvailabilityReasonSchema,
  })
  .strict();

export const featureContractResponseSchema = z
  .object({
    data: z.object({
      planKey: z.string().trim().min(1).max(100).nullable(),
      planStatus: z
        .enum(['active', 'trialing', 'past_due', 'canceled', 'expired'])
        .nullable(),
      features: z.array(featureContractItemSchema),
    }),
  })
  .strict();

export type FeatureFlagUpdate = z.infer<typeof featureFlagUpdateSchema>;
export type FeatureContractItem = z.infer<typeof featureContractItemSchema>;
export type FeatureContractResponse = z.infer<
  typeof featureContractResponseSchema
>;
