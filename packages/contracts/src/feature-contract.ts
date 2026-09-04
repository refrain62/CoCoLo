import { z } from 'zod';
import { uuidv7Schema } from './auth-team-selection-contract.ts';

export const featureKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9._-]{1,63}$/, 'feature keyが不正です。');
export const featureBillingTypeSchema = z.enum(['free', 'paid']);
export const featurePlanStatusSchema = z.enum([
  'active',
  'trialing',
  'past_due',
  'canceled',
  'expired',
]);
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

const featureKeyListSchema = z
  .array(featureKeySchema)
  .max(100)
  .refine(
    (keys) => new Set(keys).size === keys.length,
    'feature keyが重複しています。',
  );

const operatorTimestampSchema = z.string().datetime();

// 課金連携から受け取る値だけを内部routeへ通し、tenantと運用者IDは監査対象として固定する。
export const featurePlanSyncSchema = z
  .object({
    tenantId: uuidv7Schema,
    providerAccountId: z.string().trim().min(1).max(128),
    eventId: z.string().trim().min(1).max(128),
    version: z.number().int().min(1).max(2147483647),
    planKey: z.string().trim().min(1).max(100),
    status: featurePlanStatusSchema,
    featureKeys: featureKeyListSchema,
    billingProviderSubscriptionId: z.string().trim().min(1).max(256).nullable(),
    startsAt: operatorTimestampSchema,
    endsAt: operatorTimestampSchema.nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      (input.status === 'active' || input.status === 'trialing') &&
      !input.billingProviderSubscriptionId
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['billingProviderSubscriptionId'],
        message: 'active/trialingのプランには契約IDが必要です。',
      });
  });

export const paidFeatureGrantSchema = z
  .object({
    tenantId: uuidv7Schema,
    providerAccountId: z.string().trim().min(1).max(128),
    approvalId: uuidv7Schema,
    billingStatus: featurePlanStatusSchema,
    billingProviderSubscriptionId: z.string().trim().min(1).max(256),
    eventId: z.string().trim().min(1).max(128),
    version: z.number().int().min(1).max(2147483647),
    featureKey: featureKeySchema,
    enabled: z.boolean(),
    reason: z.string().trim().min(1).max(500),
    startsAt: operatorTimestampSchema,
    endsAt: operatorTimestampSchema.nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.billingStatus !== 'active' && input.billingStatus !== 'trialing')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['billingStatus'],
        message: '有償feature付与には有効な課金状態が必要です。',
      });
  });

export type FeatureFlagUpdate = z.infer<typeof featureFlagUpdateSchema>;
export type FeatureContractItem = z.infer<typeof featureContractItemSchema>;
export type FeatureContractResponse = z.infer<
  typeof featureContractResponseSchema
>;
export type FeaturePlanSync = z.infer<typeof featurePlanSyncSchema>;
export type PaidFeatureGrant = z.infer<typeof paidFeatureGrantSchema>;
