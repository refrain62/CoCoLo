import type {
  TeamOption,
  TeamSelectionRequest,
} from '@cocolo/contracts/auth-team-selection';

type TeamListResponse = { data: TeamOption[] };
type TeamSelectionResponse = { data: TeamOption };
type ErrorResponse = {
  error?: { code?: string; message?: string };
};

export class TeamSelectionApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TeamSelectionApiError';
  }
}

export type TeamSelectionApi = {
  list: () => Promise<TeamOption[]>;
  select: (request: TeamSelectionRequest) => Promise<TeamOption>;
};

type TeamSelectionApiOptions = {
  baseUrl?: string;
  getAccessToken?: () => string | null;
  fetcher?: typeof fetch;
};

function getStoredAccessToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('cocolo.accessToken');
}

async function readError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as ErrorResponse;
  return new TeamSelectionApiError(
    response.status,
    body.error?.code ?? 'REQUEST_FAILED',
    body.error?.message ?? 'チーム情報の取得に失敗しました。',
  );
}

// チーム選択APIへのBearer付与と共通エラー変換を一箇所へ集約する。
export function createTeamSelectionApi({
  baseUrl = '',
  getAccessToken = getStoredAccessToken,
  fetcher = fetch,
}: TeamSelectionApiOptions = {}): TeamSelectionApi {
  let listInFlight: Promise<TeamOption[]> | null = null;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const accessToken = getAccessToken();
    if (!accessToken)
      throw new TeamSelectionApiError(
        401,
        'UNAUTHENTICATED',
        'ログインが必要です。',
      );
    const response = await fetcher(`${baseUrl}${path}`, {
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

  // 同一ログイン中の初期化重複を抑え、チーム一覧取得を一つの要求へ集約する。
  function list() {
    if (listInFlight) return listInFlight;
    const requestPromise = request<TeamListResponse>('/api/v1/auth/teams').then(
      (response) => response.data,
    );
    const sharedPromise = requestPromise.finally(() => {
      if (listInFlight === sharedPromise) listInFlight = null;
    });
    listInFlight = sharedPromise;
    return sharedPromise;
  }

  return {
    list,
    async select(requestBody) {
      const response = await request<TeamSelectionResponse>(
        '/api/v1/auth/teams/select',
        { method: 'POST', body: JSON.stringify(requestBody) },
      );
      return response.data;
    },
  };
}
