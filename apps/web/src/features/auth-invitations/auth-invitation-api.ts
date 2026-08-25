import {
  type InvitationAcceptInput,
  type InvitationCreateInput,
  invitationAcceptResponseSchema,
  invitationCreateResponseSchema,
} from '@cocolo/contracts/auth-invitation';
import { selectedTeamHeaderName } from '../auth-team-selection/selected-team-storage.js';

type ErrorResponse = { error?: { code?: string; message?: string } };

export type InvitationAcceptResult = {
  tenantId: string;
  memberId: string;
  role: 'guardian';
  linkStatus: 'active';
};

export type InvitationCreateResult = {
  id: string;
  memberId: string;
  role: 'guardian';
  relationship: string;
  inviteUrl: string;
  expiresAt: string;
};

export class AuthInvitationApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthInvitationApiError';
  }
}

export type AuthInvitationApi = {
  create: (input: InvitationCreateInput) => Promise<InvitationCreateResult>;
  accept: (input: InvitationAcceptInput) => Promise<InvitationAcceptResult>;
};

type AuthInvitationApiOptions = {
  baseUrl?: string;
  getSelectedTeamId?: () => string | null;
  fetcher?: typeof fetch;
};

async function readError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as ErrorResponse;
  return new AuthInvitationApiError(
    response.status,
    body.error?.code ?? 'REQUEST_FAILED',
    body.error?.message ?? '招待の受諾に失敗しました。',
  );
}

// 招待受諾は認証済みfetchへ委譲し、provider subjectの再検証をAPI側へ任せる。
export function createAuthInvitationApi({
  baseUrl = '',
  getSelectedTeamId = () => null,
  fetcher = fetch,
}: AuthInvitationApiOptions = {}): AuthInvitationApi {
  async function request<T>(path: string, init?: RequestInit) {
    const response = await fetcher(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
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
    async create(input) {
      const body = await request<unknown>('/api/v1/auth/invitations', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const parsed = invitationCreateResponseSchema.safeParse(body);
      if (!parsed.success)
        throw new AuthInvitationApiError(
          502,
          'INVALID_RESPONSE',
          '招待発行の応答が不正です。',
        );
      return parsed.data.data;
    },
    async accept(input) {
      const parsed = invitationAcceptResponseSchema.safeParse(
        await request<unknown>('/api/v1/auth/invitations/accept', {
          method: 'POST',
          body: JSON.stringify(input),
        }),
      );
      if (!parsed.success)
        throw new AuthInvitationApiError(
          502,
          'INVALID_RESPONSE',
          '招待受諾の応答が不正です。',
        );
      return parsed.data.data;
    },
  };
}
