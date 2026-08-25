import { selectedTeamHeaderName } from '../auth-team-selection/selected-team-storage.js';

export type LineConnectionStatus = 'connected' | 'disconnected';

export type LineStatus = {
  status: LineConnectionStatus;
  groupId: string | null;
};

export type LineNotificationInput = {
  sourceType: 'event' | 'deadline' | 'bulletin';
  sourceId: string;
  destination: string;
  title: string;
  body: string;
};

export type LineDeliveryResult = {
  notificationId: string;
  status: 'pending';
};

type LineApiErrorBody = {
  error?: { code?: string; message?: string };
};

export class LineApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LineApiError';
  }
}

export type LineNotificationApi = {
  status: () => Promise<LineStatus>;
  connect: (groupId: string) => Promise<LineStatus>;
  disconnect: () => Promise<void>;
  enqueue: (input: LineNotificationInput) => Promise<LineDeliveryResult>;
  retry: (notificationId: string) => Promise<LineDeliveryResult>;
};

type LineNotificationApiOptions = {
  baseUrl?: string;
  getAccessToken?: () => string | null;
  getSelectedTeamId?: () => string | null;
  fetcher?: typeof fetch;
};

function getStoredAccessToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('cocolo.accessToken');
}

async function readError(response: Response): Promise<LineApiError> {
  const body = (await response.json().catch(() => ({}))) as LineApiErrorBody;
  return new LineApiError(
    response.status,
    body.error?.code ?? 'REQUEST_FAILED',
    body.error?.message ?? '通信に失敗しました。',
  );
}

// LINEの秘密情報をWebへ渡さず、認証トークンと通知DTOだけをAPIへ送る。
export function createLineNotificationApi({
  baseUrl = '',
  getAccessToken = getStoredAccessToken,
  getSelectedTeamId,
  fetcher = fetch,
}: LineNotificationApiOptions = {}): LineNotificationApi {
  async function requestUrl<T>(url: string, init?: RequestInit): Promise<T> {
    const accessToken = getAccessToken();
    if (!accessToken)
      throw new LineApiError(401, 'UNAUTHENTICATED', 'ログインが必要です。');
    const selectedTeamId = getSelectedTeamId?.();
    const response = await fetcher(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(selectedTeamId ? { [selectedTeamHeaderName]: selectedTeamId } : {}),
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) throw await readError(response);
    return (await response.json()) as T;
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    return requestUrl<T>(`${baseUrl}/api/v1/line${path}`, init);
  }

  return {
    async status() {
      const response = await request<{ data: LineStatus }>('/status');
      return response.data;
    },
    async connect(groupId) {
      if (!groupId.trim())
        throw new LineApiError(
          400,
          'VALIDATION_ERROR',
          'グループIDを入力してください。',
        );
      const response = await request<{ data: LineStatus }>('/connect', {
        method: 'POST',
        body: JSON.stringify({ groupId: groupId.trim() }),
      });
      return response.data;
    },
    async disconnect() {
      await request('/connect', { method: 'DELETE' });
    },
    async enqueue(input) {
      const response = await requestUrl<{ data: LineDeliveryResult }>(
        `${baseUrl}/api/v1/notifications/line`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify(input),
        },
      );
      return response.data;
    },
    async retry(notificationId) {
      const response = await requestUrl<{ data: LineDeliveryResult }>(
        `${baseUrl}/api/v1/notifications/line/${encodeURIComponent(notificationId)}/retry`,
        { method: 'POST' },
      );
      return response.data;
    },
  };
}
