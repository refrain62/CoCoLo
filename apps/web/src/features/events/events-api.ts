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
      memberId: string;
      response: AttendanceResponse;
      correctionReason?: string;
    },
  ) => Promise<{
    eventId: string;
    memberId: string;
    response: AttendanceResponse;
    updatedAt: string;
  }>;
  summary: (eventId: string) => Promise<AttendanceSummary>;
};

type EventsApiOptions = {
  baseUrl?: string;
  getAccessToken?: () => string | null;
  fetcher?: typeof fetch;
};

type ErrorBody = { error?: { code?: string; message?: string } };

function storedAccessToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('cocolo.accessToken');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isEventSummary(value: unknown): value is EventSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    (value.type === 'practice' ||
      value.type === 'match' ||
      value.type === 'event') &&
    isDateString(value.startsAt) &&
    isDateString(value.endsAt) &&
    (typeof value.location === 'string' || value.location === null) &&
    (typeof value.itemsToBring === 'string' || value.itemsToBring === null) &&
    typeof value.fee === 'number' &&
    Number.isInteger(value.fee) &&
    value.fee >= 0 &&
    (typeof value.announcementImageAttachmentId === 'string' ||
      value.announcementImageAttachmentId === null) &&
    (typeof value.opponent === 'string' || value.opponent === null) &&
    (typeof value.meetingTime === 'string' || value.meetingTime === null) &&
    (typeof value.meetingTime !== 'string' ||
      isDateString(value.meetingTime)) &&
    typeof value.transportationRequired === 'boolean' &&
    isDateString(value.attendanceDeadline) &&
    isDateString(value.createdAt) &&
    isDateString(value.updatedAt)
  );
}

function isAttendanceResponse(value: unknown): value is AttendanceResponse {
  return value === 'attending' || value === 'absent' || value === 'pending';
}

function isAttendanceResult(value: unknown): value is {
  eventId: string;
  memberId: string;
  response: AttendanceResponse;
  updatedAt: string;
} {
  if (!isRecord(value)) return false;
  return (
    typeof value.eventId === 'string' &&
    typeof value.memberId === 'string' &&
    isAttendanceResponse(value.response) &&
    isDateString(value.updatedAt)
  );
}

function isAttendanceSummary(value: unknown): value is AttendanceSummary {
  if (!isRecord(value)) return false;
  const countKeys = [
    'totalMembers',
    'attending',
    'absent',
    'pending',
    'unanswered',
  ] as const;
  return (
    countKeys.every(
      (key) =>
        typeof value[key] === 'number' &&
        Number.isInteger(value[key]) &&
        value[key] >= 0,
    ) &&
    Array.isArray(value.unansweredMemberIds) &&
    value.unansweredMemberIds.every((id) => typeof id === 'string')
  );
}

function readData<T>(
  body: unknown,
  guard: (value: unknown) => value is T,
  message: string,
) {
  if (!isRecord(body) || !guard(body.data))
    throw new EventsApiError(502, 'INVALID_RESPONSE', message);
  return body.data;
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
      const result = await request<unknown>(`?${params}`);
      return readData(
        result,
        (value): value is EventSummary[] =>
          Array.isArray(value) && value.every(isEventSummary),
        '予定一覧の応答形式が不正です。',
      );
    },
    async get(eventId) {
      const result = await request<unknown>(`/${eventId}`);
      return readData(result, isEventSummary, '予定詳細の応答形式が不正です。');
    },
    async create(input) {
      const result = await request<unknown>('', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return readData(result, isEventSummary, '予定登録の応答形式が不正です。');
    },
    async update(eventId, input) {
      const result = await request<unknown>(`/${eventId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
      return readData(result, isEventSummary, '予定更新の応答形式が不正です。');
    },
    async answer(eventId, input) {
      const result = await request<unknown>(`/${eventId}/attendance`, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
      return readData(
        result,
        isAttendanceResult,
        '出欠回答の応答形式が不正です。',
      );
    },
    async summary(eventId) {
      const result = await request<unknown>(`/${eventId}/attendance/summary`);
      return readData(
        result,
        isAttendanceSummary,
        '出欠集計の応答形式が不正です。',
      );
    },
  };
}
