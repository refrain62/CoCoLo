import {
  getStoredSelectedTeamId,
  selectedTeamHeaderName,
} from './features/auth-team-selection/selected-team-storage.js';

export type MemberCategory = 'student' | 'adult';
export type MemberStatus = 'active' | 'suspended' | 'retired';

export type MemberSummary = {
  id: string;
  name: string;
  kana: string | null;
  category: MemberCategory;
  gradeLevel: number | null;
  ageGroup?: string | null;
  status: MemberStatus;
  createdAt?: string;
};

export type MemberListFilters = {
  q: string;
  category: '' | MemberCategory;
  status: '' | MemberStatus;
};

export type MemberCreateInput = {
  name: string;
  kana?: string | null;
  category: MemberCategory;
  gradeLevel?: number | null;
  ageGroup?: string | null;
  status: 'active' | 'suspended';
};

export type MemberUpdateInput = {
  name: string;
  kana?: string | null;
  category: MemberCategory;
  gradeLevel?: number | null;
  ageGroup?: string | null;
  status: 'active' | 'suspended';
};

export type PromotionRequest = {
  mode: 'preview' | 'execute';
  fiscalYear: number;
};

export type PromotionSummary = {
  mode: PromotionRequest['mode'];
  fiscalYear: number;
  status: 'preview' | 'completed' | 'failed';
  previewCount: number;
  promotedCount: number;
  result: unknown;
};

type MemberListResponse = {
  data: MemberSummary[];
  page: number;
  pageSize: number;
};

type MemberApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

export class MemberApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MemberApiError';
  }
}

export type MemberApi = {
  list: (filters: MemberListFilters) => Promise<MemberSummary[]>;
  listAll: (filters: MemberListFilters) => Promise<MemberSummary[]>;
  create: (input: MemberCreateInput) => Promise<MemberSummary>;
  update: (
    memberId: string,
    input: MemberUpdateInput,
  ) => Promise<MemberSummary>;
  retire: (memberId: string) => Promise<MemberSummary>;
  promote: (
    input: PromotionRequest,
    idempotencyKey?: string,
  ) => Promise<PromotionSummary>;
};

type MemberApiOptions = {
  baseUrl?: string;
  getAccessToken?: () => string | null;
  getSelectedTeamId?: () => string | null;
};

function getStoredAccessToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('cocolo.accessToken');
}

async function readError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as MemberApiErrorBody;
  return new MemberApiError(
    response.status,
    body.error?.code ?? 'REQUEST_FAILED',
    body.error?.message ?? '通信に失敗しました。',
  );
}

// 部員APIのBearer付与、未認証拒否、共通エラー変換を一箇所へ集約する。
// baseUrlの既定値はlocal Vite proxyと同一originを使うためのもの。
export function createMemberApi({
  baseUrl = '',
  getAccessToken = getStoredAccessToken,
  getSelectedTeamId = getStoredSelectedTeamId,
}: MemberApiOptions = {}): MemberApi {
  // すべての部員リクエストでaccess tokenを必須にし、APIへ匿名リクエストを送らない。
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const accessToken = getAccessToken();
    if (!accessToken)
      throw new MemberApiError(401, 'UNAUTHENTICATED', 'ログインが必要です。');

    const response = await fetch(`${baseUrl}/api/v1/members${path}`, {
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

  async function listPage(
    filters: MemberListFilters,
    page: number,
    pageSize: number,
  ) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (filters.q.trim()) params.set('q', filters.q.trim());
    if (filters.category) params.set('category', filters.category);
    if (filters.status) params.set('status', filters.status);
    return request<MemberListResponse>(`?${params}`);
  }

  return {
    async list(filters) {
      const response = await listPage(filters, 1, 50);
      return response.data;
    },
    async listAll(filters) {
      const members: MemberSummary[] = [];
      for (let page = 1; ; page += 1) {
        const response = await listPage(filters, page, 100);
        members.push(...response.data);
        if (response.data.length < response.pageSize) return members;
      }
    },
    async create(input) {
      const response = await request<{ data: MemberSummary }>('', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return response.data;
    },
    async update(memberId, input) {
      const response = await request<{ data: MemberSummary }>(
        `/${encodeURIComponent(memberId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(input),
        },
      );
      return response.data;
    },
    async retire(memberId) {
      const response = await request<{ data: MemberSummary }>(
        `/${encodeURIComponent(memberId)}/retire`,
        { method: 'POST' },
      );
      return response.data;
    },
    async promote(input, idempotencyKey) {
      const response = await request<{ data: PromotionSummary }>('/promote', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: idempotencyKey
          ? { 'Idempotency-Key': idempotencyKey }
          : undefined,
      });
      return response.data;
    },
  };
}
