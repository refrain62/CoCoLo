export type SystemAnnouncement = {
  id: string;
  title: string;
  body: string;
  status: 'draft' | 'published' | 'archived';
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SystemFeature = {
  key: string;
  billingType: 'free' | 'paid';
  displayName: string;
  systemEnabled: boolean;
};

export class SystemAdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SystemAdminApiError';
  }
}

type SystemAdminApiOptions = {
  baseUrl?: string;
  getAccessToken: () => string | null;
  fetcher?: typeof fetch;
};

type ErrorResponse = { error?: { code?: string; message?: string } };

export type SystemAdminApi = ReturnType<typeof createSystemAdminApi>;

export function createSystemAdminApi({
  baseUrl = import.meta.env.VITE_API_URL ?? '',
  getAccessToken,
  fetcher = fetch,
}: SystemAdminApiOptions) {
  async function request<T>(path: string, init: RequestInit = {}) {
    const token = getAccessToken();
    if (!token)
      throw new SystemAdminApiError(
        401,
        'UNAUTHENTICATED',
        'ログインが必要です。',
      );
    const response = await fetcher(`${baseUrl.replace(/\/$/u, '')}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as ErrorResponse;
      throw new SystemAdminApiError(
        response.status,
        body.error?.code ?? 'REQUEST_FAILED',
        body.error?.message ?? 'システム管理APIの処理に失敗しました。',
      );
    }
    return (await response.json()) as { data: T };
  }

  return {
    listAnnouncements: async () =>
      (await request<SystemAnnouncement[]>('/api/v1/system/announcements'))
        .data,
    createAnnouncement: async (input: {
      title: string;
      body: string;
      status: SystemAnnouncement['status'];
    }) =>
      (
        await request<SystemAnnouncement>('/api/v1/system/announcements', {
          method: 'POST',
          body: JSON.stringify(input),
        })
      ).data,
    updateAnnouncement: async (
      announcementId: string,
      input: Partial<{
        title: string;
        body: string;
        status: SystemAnnouncement['status'];
      }>,
    ) =>
      (
        await request<SystemAnnouncement>(
          `/api/v1/system/announcements/${encodeURIComponent(announcementId)}`,
          { method: 'PATCH', body: JSON.stringify(input) },
        )
      ).data,
    listFeatures: async () =>
      (await request<SystemFeature[]>('/api/v1/system/features')).data,
    updateFeature: async (
      featureKey: string,
      input: { enabled: boolean; reason: string },
    ) =>
      (
        await request<SystemFeature>(
          `/api/v1/system/features/${encodeURIComponent(featureKey)}`,
          { method: 'PATCH', body: JSON.stringify(input) },
        )
      ).data,
  };
}
