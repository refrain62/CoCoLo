import { selectedTeamHeaderName } from '../auth-team-selection/selected-team-storage.js';

export type LineConnectionStatus = 'connected' | 'disconnected';
export type LineNotificationSource = 'event' | 'deadline' | 'bulletin';

export type LineNotificationStatus = 'pending' | 'sending' | 'sent' | 'failed';

export type LineStatus = {
  status: LineConnectionStatus;
  groupId: string | null;
};

export type LineNotificationInput = {
  sourceType: LineNotificationSource;
  sourceId: string;
  title: string;
  body: string;
  deepLink: string;
};

export type LineNotification = {
  id: string;
  sourceType: LineNotificationSource;
  sourceId: string;
  status: LineNotificationStatus;
  attempts: number;
  nextRetryAt: string | null;
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
  enqueue: (
    input: LineNotificationInput,
  ) => Promise<
    | { status: 'queued'; notification: LineNotification }
    | { status: 'not_connected'; notification: null }
  >;
  retry: (notificationId: string) => Promise<LineNotification>;
};

type LineNotificationApiOptions = {
  baseUrl?: string;
  getAccessToken?: () => string | null;
  getSelectedTeamId?: () => string | null;
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
}: LineNotificationApiOptions = {}): LineNotificationApi {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const accessToken = getAccessToken();
    if (!accessToken)
      throw new LineApiError(401, 'UNAUTHENTICATED', 'ログインが必要です。');
    const selectedTeamId = getSelectedTeamId?.();
    const response = await fetch(`${baseUrl}/api/v1/line${path}`, {
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
      const response = await request<{
        data:
          | { status: 'queued'; notification: LineNotification }
          | { status: 'not_connected'; notification: null };
      }>('/notifications', { method: 'POST', body: JSON.stringify(input) });
      return response.data;
    },
    async retry(notificationId) {
      const response = await request<{ data: LineNotification }>(
        `/notifications/${encodeURIComponent(notificationId)}/retry`,
        { method: 'POST' },
      );
      return response.data;
    },
  };
}
