import { selectedTeamHeaderName } from '@cocolo/contracts/auth-team-selection';

export type OrdersProduct = {
  id: string;
  name: string;
  unitPrice: number;
  imageUrl: string | null;
  options: Array<{ name: string; values: string[] }>;
  requiresBackNumber: boolean;
  requiresBackName: boolean;
};

export type OrdersCampaign = {
  id: string;
  title: string;
  deadline: string;
  status: 'open' | 'closed' | 'completed';
  products: OrdersProduct[];
  createdAt: string;
};

export type OrdersEntry = {
  id: string;
  campaignId: string;
  ordererName: string;
  memberId: string;
  memberName: string;
  lines: Array<{
    id: string;
    productId: string;
    productName: string;
    unitPrice: number;
    quantity: number;
    selectedOptions: Record<string, string>;
    backNumber: string | null;
    backName: string | null;
    amount: number;
  }>;
  totalAmount: number;
  paymentStatus: 'unpaid' | 'paid';
  paymentConfirmedAt: string | null;
  paymentConfirmedBy: string | null;
  createdAt: string;
};

export type OrdersSummary = {
  totalOrders: number;
  totalAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  byProduct: Array<{
    productId: string;
    productName: string;
    selectedOptions: Record<string, string>;
    quantity: number;
    amount: number;
  }>;
  unpaid: Array<{
    entryId: string;
    ordererName: string;
    memberName: string;
    amount: number;
  }>;
};

export type OrdersPaymentsApi = {
  listCampaigns: () => Promise<OrdersCampaign[]>;
  createCampaign: (input: {
    title: string;
    deadline: string;
    products: Array<{
      name: string;
      unitPrice: number;
      options: Array<{ name: string; values: string[] }>;
      requiresBackNumber: boolean;
      requiresBackName: boolean;
    }>;
  }) => Promise<OrdersCampaign>;
  createEntry: (
    campaignId: string,
    input: {
      memberId: string;
      ordererName: string;
      lines: Array<{
        productId: string;
        quantity: number;
        selectedOptions: Record<string, string>;
        backNumber: string | null;
        backName: string | null;
      }>;
    },
  ) => Promise<OrdersEntry>;
  listEntries: (campaignId: string) => Promise<OrdersEntry[]>;
  updatePayment: (
    campaignId: string,
    entryId: string,
    status: 'unpaid' | 'paid',
  ) => Promise<OrdersEntry>;
  getSummary: (campaignId: string) => Promise<OrdersSummary>;
  exportCsv: (campaignId: string) => Promise<Blob>;
};

export class OrdersPaymentsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'OrdersPaymentsApiError';
  }
}

type ApiOptions = {
  baseUrl?: string;
  getAccessToken: () => string | null;
  getSelectedTeamId?: () => string | null;
  fetcher?: typeof fetch;
};

async function readError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
  };
  return new OrdersPaymentsApiError(
    response.status,
    body.error?.message ?? '共同購買の処理に失敗しました。',
  );
}

export function createOrdersPaymentsApi({
  baseUrl = import.meta.env.VITE_API_URL ?? '',
  getAccessToken,
  getSelectedTeamId = () => null,
  fetcher = fetch,
}: ApiOptions): OrdersPaymentsApi {
  async function request(path: string, init: RequestInit = {}) {
    const token = getAccessToken();
    if (!token) throw new OrdersPaymentsApiError(401, 'ログインが必要です。');
    const selectedTeamId = getSelectedTeamId();
    const response = await fetcher(`${baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(selectedTeamId ? { [selectedTeamHeaderName]: selectedTeamId } : {}),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) throw await readError(response);
    return response;
  }

  async function json<T>(path: string, init?: RequestInit) {
    return (await (await request(path, init)).json()) as { data: T };
  }

  return {
    async listCampaigns() {
      return (await json<OrdersCampaign[]>('/api/v1/orders')).data;
    },
    async createCampaign(input) {
      return (
        await json<OrdersCampaign>('/api/v1/orders', {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify(input),
        })
      ).data;
    },
    async createEntry(campaignId, input) {
      return (
        await json<OrdersEntry>(`/api/v1/orders/${campaignId}/entries`, {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify(input),
        })
      ).data;
    },
    async listEntries(campaignId) {
      return (await json<OrdersEntry[]>(`/api/v1/orders/${campaignId}/entries`))
        .data;
    },
    async updatePayment(campaignId, entryId, status) {
      return (
        await json<OrdersEntry>(
          `/api/v1/orders/${campaignId}/entries/${entryId}/payment`,
          {
            method: 'PATCH',
            headers: { 'Idempotency-Key': crypto.randomUUID() },
            body: JSON.stringify({ status }),
          },
        )
      ).data;
    },
    async getSummary(campaignId) {
      return (await json<OrdersSummary>(`/api/v1/orders/${campaignId}/summary`))
        .data;
    },
    async exportCsv(campaignId) {
      return request(`/api/v1/orders/${campaignId}/export.csv`, {
        headers: { Accept: 'text/csv' },
      }).then((response) => response.blob());
    },
  };
}
