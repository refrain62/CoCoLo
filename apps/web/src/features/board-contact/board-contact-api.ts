import {
  getStoredSelectedTeamId,
  selectedTeamHeaderName,
} from '../auth-team-selection/selected-team-storage.js';

export type BoardContactRoleType = 'admin' | 'staff' | 'member';
export type ContactPreference = 'line' | 'phone' | 'both';

export type BoardContactSummary = {
  id: string;
  fiscalYear: number;
  roleName: string;
  roleType: BoardContactRoleType;
  contactPreference: ContactPreference;
  assigneeUserId?: string;
  lineContact?: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
};

export type BoardContactCreateInput = {
  fiscalYear: number;
  roleName: string;
  roleType: BoardContactRoleType;
  assigneeUserId?: string | null;
  lineContact?: string | null;
  phone?: string | null;
  contactPreference: ContactPreference;
};

export type BoardContactPatchInput = Partial<BoardContactCreateInput>;

export class BoardContactApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BoardContactApiError';
  }
}

export type BoardContactApi = {
  list: (fiscalYear?: number) => Promise<BoardContactSummary[]>;
  create: (input: BoardContactCreateInput) => Promise<BoardContactSummary>;
  update: (
    boardContactId: string,
    patch: BoardContactPatchInput,
  ) => Promise<BoardContactSummary>;
  remove: (boardContactId: string) => Promise<void>;
  copyYear: (
    fromFiscalYear: number,
    toFiscalYear: number,
  ) => Promise<BoardContactSummary[]>;
};

type BoardContactApiOptions = {
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
  return new BoardContactApiError(
    response.status,
    body.error?.code ?? 'REQUEST_FAILED',
    body.error?.message ?? '通信に失敗しました。',
  );
}

// 役員APIの認証ヘッダーとエラー形式を一箇所へ集約し、画面がtenantや個人情報を組み立てないようにする。
export function createBoardContactApi({
  baseUrl = '',
  getAccessToken = getStoredAccessToken,
  getSelectedTeamId = getStoredSelectedTeamId,
  fetcher = fetch,
}: BoardContactApiOptions = {}): BoardContactApi {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

  async function request<T>(
    path: string,
    init?: RequestInit,
    hasJsonResponse = true,
  ): Promise<T> {
    const accessToken = getAccessToken();
    if (!accessToken)
      throw new BoardContactApiError(
        401,
        'UNAUTHENTICATED',
        'ログインが必要です。',
      );
    const selectedTeamId = getSelectedTeamId();

    const response = await fetcher(
      `${normalizedBaseUrl}/api/v1/board-members${path}`,
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
    if (!hasJsonResponse) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    async list(fiscalYear) {
      const query = fiscalYear === undefined ? '' : `?fiscalYear=${fiscalYear}`;
      const response = await request<{ data: BoardContactSummary[] }>(query);
      return response.data;
    },
    async create(input) {
      const response = await request<{ data: BoardContactSummary }>('', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return response.data;
    },
    async update(boardContactId, patch) {
      const response = await request<{ data: BoardContactSummary }>(
        `/${encodeURIComponent(boardContactId)}`,
        { method: 'PATCH', body: JSON.stringify(patch) },
      );
      return response.data;
    },
    async remove(boardContactId) {
      await request<void>(
        `/${encodeURIComponent(boardContactId)}`,
        {
          method: 'DELETE',
        },
        false,
      );
    },
    async copyYear(fromFiscalYear, toFiscalYear) {
      const response = await request<{ data: BoardContactSummary[] }>(
        '/copy-year',
        {
          method: 'POST',
          body: JSON.stringify({ fromFiscalYear, toFiscalYear }),
        },
      );
      return response.data;
    },
  };
}
