export type SystemContext = {
  systemAdmin: true;
};

export class SystemContextApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SystemContextApiError';
  }
}

type SystemContextApiOptions = {
  baseUrl?: string;
  getAccessToken?: () => string | null;
  fetcher?: typeof fetch;
};

type ErrorResponse = { error?: { code?: string; message?: string } };

// システム管理者判定は署名済みJWTを検証したAPIの結果だけを使い、ブラウザ保存値を権限情報として扱わない。
export function createSystemContextApi({
  baseUrl = '',
  getAccessToken = () => null,
  fetcher = fetch,
}: SystemContextApiOptions = {}) {
  return {
    async get(): Promise<SystemContext> {
      const accessToken = getAccessToken();
      if (!accessToken)
        throw new SystemContextApiError(
          401,
          'UNAUTHENTICATED',
          'ログインが必要です。',
        );
      const response = await fetcher(`${baseUrl}/api/v1/system/context`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ErrorResponse;
        throw new SystemContextApiError(
          response.status,
          body.error?.code ?? 'REQUEST_FAILED',
          body.error?.message ?? 'システム管理者権限を確認できません。',
        );
      }
      return ((await response.json()) as { data: SystemContext }).data;
    },
  };
}
