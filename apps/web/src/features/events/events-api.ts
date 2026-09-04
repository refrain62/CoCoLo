import {
  getStoredSelectedTeamId,
  selectedTeamHeaderName,
} from '../auth-team-selection/selected-team-storage.js';

export type EventType = 'practice' | 'match' | 'event';
export type AttendanceResponse = 'attending' | 'absent' | 'pending';
export type EventRole = 'owner' | 'admin' | 'staff' | 'guardian';

export type EventSummary = {
  id: string;
  title: string;
  type: EventType;
  startsAt: string;
  endsAt: string;
  location: string | null;
  itemsToBring: string | null;
  fee: number;
  announcementImageAttachmentId: string | null;
  opponent: string | null;
  meetingTime: string | null;
  transportationRequired: boolean;
  attendanceDeadline: string;
  createdAt: string;
  updatedAt: string;
};

export type EventCreateInput = {
  title: string;
  type: EventType;
  startsAt: string;
  endsAt: string;
  location?: string | null;
  itemsToBring?: string | null;
  fee: number;
  announcementImageAttachmentId?: string | null;
  opponent?: string | null;
  meetingTime?: string | null;
  transportationRequired: boolean;
  attendanceDeadline: string;
};

export type EventUpdateInput = Partial<EventCreateInput>;

export type AttendanceSummary = {
  totalMembers: number;
  attending: number;
  absent: number;
  pending: number;
  unanswered: number;
  unansweredMemberIds: string[];
};

export type CurrentAttendance = {
  eventId: string;
  memberId: string;
  response: AttendanceResponse;
  updatedAt: string;
};

export class EventsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EventsApiError';
  }
}

export type EventsApi = {
  list: (from: string, to: string) => Promise<EventSummary[]>;
  get: (eventId: string) => Promise<EventSummary>;
  create: (input: EventCreateInput) => Promise<EventSummary>;
  update: (eventId: string, input: EventUpdateInput) => Promise<EventSummary>;
  answer: (
    eventId: string,
    input: {
      memberId?: string;
      subjectMemberId?: string;
      response: AttendanceResponse;
      correctionReason?: string;
    },
  ) => Promise<CurrentAttendance>;
  currentAttendance: (eventId: string) => Promise<CurrentAttendance[]>;
  summary: (eventId: string) => Promise<AttendanceSummary>;
};

type EventsApiOptions = {
  baseUrl?: string;
  getAccessToken?: () => string | null;
  getSelectedTeamId?: () => string | null;
  fetcher?: typeof fetch;
};

type ErrorBody = { error?: { code?: string; message?: string } };

function storedAccessToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('cocolo.accessToken');
}

async function readError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as ErrorBody;
  return new EventsApiError(
    response.status,
    body.error?.code ?? 'REQUEST_FAILED',
    body.error?.message ?? '通信に失敗しました。',
  );
}

// 予定APIの認証ヘッダーとエラー形式を集約し、画面ごとの認証実装の差異を防ぐ。
export function createEventsApi({
  baseUrl = '',
  getAccessToken = storedAccessToken,
  getSelectedTeamId = getStoredSelectedTeamId,
  fetcher = fetch,
}: EventsApiOptions = {}): EventsApi {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const accessToken = getAccessToken();
    if (!accessToken)
      throw new EventsApiError(401, 'UNAUTHENTICATED', 'ログインが必要です。');
    const response = await fetcher(`${baseUrl}/api/v1/events${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(getSelectedTeamId()
          ? { [selectedTeamHeaderName]: getSelectedTeamId() as string }
          : {}),
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) throw await readError(response);
    return (await response.json()) as T;
  }

  return {
    async list(from, to) {
      const params = new URLSearchParams({ from, to });
      const result = await request<{ data: EventSummary[] }>(`?${params}`);
      return result.data;
    },
    async get(eventId) {
      const result = await request<{ data: EventSummary }>(`/${eventId}`);
      return result.data;
    },
    async create(input) {
      const result = await request<{ data: EventSummary }>('', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return result.data;
    },
    async update(eventId, input) {
      const result = await request<{ data: EventSummary }>(`/${eventId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
      return result.data;
    },
    async answer(eventId, input) {
      const result = await request<{ data: CurrentAttendance }>(
        `/${eventId}/attendance`,
        {
          method: 'PUT',
          body: JSON.stringify(input),
        },
      );
      return result.data;
    },
    async currentAttendance(eventId) {
      const result = await request<{ data: CurrentAttendance[] }>(
        `/${eventId}/attendance`,
      );
      return result.data;
    },
    async summary(eventId) {
      const result = await request<{ data: AttendanceSummary }>(
        `/${eventId}/attendance/summary`,
      );
      return result.data;
    },
  };
}
