import {
  getStoredSelectedTeamId,
  selectedTeamHeaderName,
} from '../auth-team-selection/selected-team-storage.js';

export type BulletinBoardRole = 'owner' | 'admin' | 'staff' | 'guardian';

export type BulletinAttachment = {
  id: string;
  mediaType: 'image/jpeg' | 'image/png' | 'application/pdf';
  byteSize: number;
};

export type AnnouncementSummary = {
  id: string;
  title: string;
  status: 'published' | 'archived';
  publishedAt: string;
  attachmentCount: number;
  readAt: string | null;
  isRead: boolean;
  isAuthor: boolean;
};

export type Announcement = AnnouncementSummary & {
  body: string;
  attachments: BulletinAttachment[];
  canViewUnread: boolean;
};

export type AnnouncementList = {
  data: AnnouncementSummary[];
  page: number;
  pageSize: number;
  hasNext: boolean;
};

export type AnnouncementCreateInput = {
  title: string;
  body: string;
  attachmentIds: string[];
};

export type UnreadMember = {
  userId: string;
  role: BulletinBoardRole;
};

export class BulletinBoardApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BulletinBoardApiError';
  }
}

type BulletinBoardApiOptions = {
  baseUrl?: string;
  getAccessToken?: () => string | null;
  getSelectedTeamId?: () => string | null;
  fetcher?: typeof fetch;
};

type ErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

function getStoredAccessToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('cocolo.accessToken');
}

async function readError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as ErrorBody;
  return new BulletinBoardApiError(
    response.status,
    body.error?.code ?? 'REQUEST_FAILED',
    body.error?.message ?? '通信に失敗しました。',
  );
}

// APIパスとBearer付与をfeature内に閉じ込め、中央画面へ接続する際の変更点を一箇所にする。
export function createBulletinBoardApi({
  baseUrl = '',
  getAccessToken = getStoredAccessToken,
  getSelectedTeamId = getStoredSelectedTeamId,
  fetcher = fetch,
}: BulletinBoardApiOptions = {}) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const accessToken = getAccessToken();
    if (!accessToken)
      throw new BulletinBoardApiError(
        401,
        'UNAUTHENTICATED',
        'ログインが必要です。',
      );
    const selectedTeamId = getSelectedTeamId();
    const response = await fetcher(`${baseUrl}/api/v1/announcements${path}`, {
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
    list: async (page = 1, pageSize = 50) => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      return request<AnnouncementList>(`?${params}`);
    },
    get: async (announcementId: string) => {
      const response = await request<{ data: Announcement }>(
        `/${encodeURIComponent(announcementId)}`,
      );
      return response.data;
    },
    publish: async (input: AnnouncementCreateInput) => {
      const response = await request<{ data: Announcement }>('', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return response.data;
    },
    markRead: async (announcementId: string) => {
      const response = await request<{ data: { readAt: string } }>(
        `/${encodeURIComponent(announcementId)}/read`,
        { method: 'POST' },
      );
      return response.data;
    },
    listUnread: async (announcementId: string) => {
      const response = await request<{
        data: UnreadMember[];
        unreadCount: number;
      }>(`/${encodeURIComponent(announcementId)}/unread`);
      return response;
    },
  };
}

export type BulletinBoardApi = ReturnType<typeof createBulletinBoardApi>;
