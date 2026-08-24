import { selectedTeamHeaderName } from '@cocolo/contracts/auth-team-selection';
import { getStoredSelectedTeamId } from './features/auth-team-selection/selected-team-storage.js';

export type AuthRole = 'owner' | 'admin' | 'staff' | 'guardian';

export type AuthContext = {
  tenantId: string;
  role: AuthRole;
};

type AuthContextApiOptions = {
  baseUrl?: string;
  getAccessToken?: () => string | null;
  getSelectedTeamId?: () => string | null;
  fetcher?: typeof fetch;
};

type AuthContextResponse = { data: AuthContext };
type ErrorResponse = { error?: { code?: string; message?: string } };

export class AuthContextApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthContextApiError';
  }
}

// 中央APIが解決した所属roleだけを利用し、JWTの未検証claimで画面権限を決めない。
export function createAuthContextApi({
  baseUrl = '',
  getAccessToken = () => null,
  getSelectedTeamId = getStoredSelectedTeamId,
  fetcher = fetch,
}: AuthContextApiOptions = {}) {
  return {
    async get(): Promise<AuthContext> {
      const accessToken = getAccessToken();
      if (!accessToken)
        throw new AuthContextApiError(
          401,
          'UNAUTHENTICATED',
          'ログインが必要です。',
        );
      const response = await fetcher(`${baseUrl}/api/v1/auth/context`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...(getSelectedTeamId()
            ? { [selectedTeamHeaderName]: getSelectedTeamId() as string }
            : {}),
        },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ErrorResponse;
        throw new AuthContextApiError(
          response.status,
          body.error?.code ?? 'REQUEST_FAILED',
          body.error?.message ?? '所属情報の取得に失敗しました。',
        );
      }
      return ((await response.json()) as AuthContextResponse).data;
    },
  };
}
