import {
  getStoredSelectedTeamId,
  selectedTeamHeaderName,
} from '../auth-team-selection/selected-team-storage.js';

export type FeatureBillingType = 'free' | 'paid';
export type FeatureAvailabilityReason =
  | 'default'
  | 'flag'
  | 'plan'
  | 'unavailable';

export type FeatureContractItem = {
  key: string;
  billingType: FeatureBillingType;
  displayName: string;
  enabled: boolean;
  reason: FeatureAvailabilityReason;
};

export type FeatureContractSnapshot = {
  planKey: string | null;
  planStatus:
    | 'active'
    | 'trialing'
    | 'past_due'
    | 'canceled'
    | 'expired'
    | null;
  features: FeatureContractItem[];
};

export class FeatureContractApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FeatureContractApiError';
  }
}

type FeatureContractApiOptions = {
  baseUrl?: string;
  getAccessToken?: () => string | null;
  getSelectedTeamId?: () => string | null;
  fetcher?: typeof fetch;
};

type ErrorResponse = { error?: { code?: string; message?: string } };

function storedAccessToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('cocolo.accessToken');
}

const planStatuses = [
  'active',
  'trialing',
  'past_due',
  'canceled',
  'expired',
] as const;

function isFeatureContractItem(value: unknown): value is FeatureContractItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.key === 'string' &&
    typeof item.displayName === 'string' &&
    (item.billingType === 'free' || item.billingType === 'paid') &&
    typeof item.enabled === 'boolean' &&
    ['default', 'flag', 'plan', 'unavailable'].includes(String(item.reason))
  );
}

async function readError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as ErrorResponse;
  return new FeatureContractApiError(
    response.status,
    body.error?.code ?? 'REQUEST_FAILED',
    body.error?.message ?? '機能契約を取得できません。',
  );
}

function isFeatureContractSnapshot(
  value: unknown,
): value is FeatureContractSnapshot {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return (
    (typeof data.planKey === 'string' || data.planKey === null) &&
    (data.planStatus === null ||
      (typeof data.planStatus === 'string' &&
        planStatuses.includes(
          data.planStatus as (typeof planStatuses)[number],
        ))) &&
    Array.isArray(data.features) &&
    data.features.every(isFeatureContractItem)
  );
}

// 機能契約は画面表示の補助であり、レスポンスを検証して未知の状態を無効扱いにする。
function parseSnapshot(value: unknown): FeatureContractSnapshot {
  const data =
    value && typeof value === 'object' && 'data' in value
      ? (value as { data: unknown }).data
      : value;
  if (!isFeatureContractSnapshot(data))
    throw new FeatureContractApiError(
      502,
      'INVALID_RESPONSE',
      '機能契約の形式が不正です。',
    );
  return data;
}

export type FeatureContractApi = {
  get: () => Promise<FeatureContractSnapshot>;
  updateFreeFlag: (input: {
    featureKey: string;
    enabled: boolean;
    reason: string;
  }) => Promise<FeatureContractSnapshot>;
};

export function createFeatureContractApi({
  baseUrl = '',
  fetcher = fetch,
  getAccessToken = storedAccessToken,
  getSelectedTeamId = getStoredSelectedTeamId,
}: FeatureContractApiOptions = {}): FeatureContractApi {
  let getInFlight: Promise<FeatureContractSnapshot> | null = null;

  async function request(path: string, init?: RequestInit) {
    const accessToken = getAccessToken();
    if (!accessToken)
      throw new FeatureContractApiError(
        401,
        'UNAUTHENTICATED',
        'ログインが必要です。',
      );
    const selectedTeamId = getSelectedTeamId();
    const response = await fetcher(
      `${baseUrl}/api/v1/feature-contract${path}`,
      {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...(selectedTeamId
            ? { [selectedTeamHeaderName]: selectedTeamId }
            : {}),
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...init?.headers,
        },
      },
    );
    if (!response.ok) throw await readError(response);
    return parseSnapshot(await response.json());
  }

  // StrictModeや同一画面からの同時参照で、同じ契約取得をrate limitへ重複計上しない。
  function get() {
    if (getInFlight) return getInFlight;
    const requestPromise = request('');
    const sharedPromise = requestPromise.finally(() => {
      if (getInFlight === sharedPromise) getInFlight = null;
    });
    getInFlight = sharedPromise;
    return sharedPromise;
  }

  return {
    get,
    updateFreeFlag: ({ featureKey, enabled, reason }) =>
      request(`/${encodeURIComponent(featureKey)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled, reason }),
      }),
  };
}
