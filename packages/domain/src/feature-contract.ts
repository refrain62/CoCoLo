export type FeatureBillingType = 'free' | 'paid';
export type TenantPlanStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'expired';
export type FeatureFlagSource = 'default' | 'admin' | 'operator' | 'billing';

export type FeatureDefinition = {
  key: string;
  billingType: FeatureBillingType;
  displayName: string;
  defaultEnabled: boolean;
  /** 未設定の既存定義は提供中として扱い、移行途中のsnapshotを壊さない。 */
  systemEnabled?: boolean;
};

export type TenantPlan = {
  status: TenantPlanStatus;
  featureKeys: string[];
  startsAt: Date;
  endsAt: Date | null;
};

export type TenantFeatureFlag = {
  featureKey: string;
  enabled: boolean;
  source: FeatureFlagSource;
  startsAt: Date;
  endsAt: Date | null;
};

export type EffectiveFeature = FeatureDefinition & {
  enabled: boolean;
  reason: 'default' | 'flag' | 'plan' | 'unavailable';
};

export type FeatureContractSnapshot = {
  planKey: string | null;
  planStatus: TenantPlanStatus | null;
  features: EffectiveFeature[];
};

function isWithinPeriod(
  now: Date,
  startsAt: Date,
  endsAt: Date | null,
): boolean {
  return startsAt <= now && (endsAt === null || now < endsAt);
}

function hasActivePlan(plan: TenantPlan | null, now: Date): boolean {
  if (!plan) return false;
  if (plan.status !== 'active' && plan.status !== 'trialing') return false;
  return isWithinPeriod(now, plan.startsAt, plan.endsAt);
}

// UIの表示ではなく、API・workerが共有するチーム単位の有効機能をfail-closedで算出する。
export function evaluateEffectiveFeatures(input: {
  definitions: FeatureDefinition[];
  plan: TenantPlan | null;
  flags: TenantFeatureFlag[];
  now?: Date;
}): EffectiveFeature[] {
  const now = input.now ?? new Date();
  const activePlan = hasActivePlan(input.plan, now);
  const planFeatures = new Set(input.plan?.featureKeys ?? []);
  const flags = new Map(
    input.flags
      .filter((flag) => isWithinPeriod(now, flag.startsAt, flag.endsAt))
      .map((flag) => [flag.featureKey, flag]),
  );

  return input.definitions.map((definition) => {
    if (definition.systemEnabled === false)
      return { ...definition, enabled: false, reason: 'unavailable' };
    const flag = flags.get(definition.key);
    if (flag) {
      if (definition.billingType === 'paid') {
        const approvedGrant =
          flag.enabled &&
          (flag.source === 'operator' || flag.source === 'billing');
        const planEntitlement =
          flag.enabled && activePlan && planFeatures.has(definition.key);
        if (!approvedGrant && !planEntitlement)
          return { ...definition, enabled: false, reason: 'unavailable' };
      }
      return { ...definition, enabled: flag.enabled, reason: 'flag' };
    }
    if (definition.billingType === 'paid') {
      const enabled = activePlan && planFeatures.has(definition.key);
      return {
        ...definition,
        enabled,
        reason: enabled ? 'plan' : 'unavailable',
      };
    }
    return {
      ...definition,
      enabled: definition.defaultEnabled,
      reason: definition.defaultEnabled ? 'default' : 'unavailable',
    };
  });
}

export function canChangeFeatureFlag(input: {
  billingType: FeatureBillingType;
  enabled: boolean;
  role: 'owner' | 'admin' | 'staff' | 'guardian';
  source: FeatureFlagSource;
  hasActivePlan: boolean;
}): boolean {
  if (input.billingType === 'free')
    return input.role === 'owner' || input.role === 'admin';
  return (
    input.enabled &&
    input.source === 'operator' &&
    input.hasActivePlan &&
    input.role === 'owner'
  );
}
