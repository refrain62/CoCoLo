export type AuthSession = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
};

type AuthResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
};

export class AuthApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuthApiError';
  }
}

export type AuthClient = {
  signInWithPassword: (email: string, password: string) => Promise<AuthSession>;
  refreshSession: (refreshToken: string) => Promise<AuthSession>;
  signOut: (accessToken: string) => Promise<void>;
};

type AuthClientOptions = {
  baseUrl?: string;
  anonKey?: string;
  fetcher?: typeof fetch;
};

type AuthOperation = 'signIn' | 'refresh' | 'signOut';

function getErrorMessage(operation: AuthOperation, status: number) {
  if (operation === 'signIn' && (status === 400 || status === 401))
    return 'メールアドレスまたはパスワードを確認してください。';
  if (operation === 'refresh')
    return 'セッションを更新できませんでした。再ログインしてください。';
  if (operation === 'signOut') return 'ログアウトに失敗しました。';
  return 'ログインに失敗しました。';
}

// Auth providerの応答本文は認証情報を含む可能性があるため、画面や例外へ渡さず固定文へ変換する。
async function readError(response: Response, operation: AuthOperation) {
  return new AuthApiError(
    response.status,
    getErrorMessage(operation, response.status),
  );
}

function getExpiresAt(body: AuthResponse) {
  if (typeof body.expires_at === 'number' && Number.isFinite(body.expires_at))
    return body.expires_at;
  if (typeof body.expires_in === 'number' && Number.isFinite(body.expires_in))
    return Math.floor(Date.now() / 1000) + body.expires_in;
  return null;
}

function parseSession(body: AuthResponse, fallbackRefreshToken: string | null) {
  if (typeof body.access_token !== 'string' || body.access_token.length === 0)
    throw new AuthApiError(502, '認証サーバーの応答が不正です。');
  return {
    accessToken: body.access_token,
    refreshToken:
      typeof body.refresh_token === 'string' && body.refresh_token.length > 0
        ? body.refresh_token
        : fallbackRefreshToken,
    expiresAt: getExpiresAt(body),
  } satisfies AuthSession;
}

// localでは相対URLをVite proxyへ送り、staging/productionではSupabase Authへ接続する。
// anon keyは公開値だが、access token以外のserver-only secretはこのclientへ渡さない。
export function createAuthClient({
  baseUrl = import.meta.env.VITE_SUPABASE_URL ?? '',
  anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
  fetcher = fetch,
}: AuthClientOptions = {}): AuthClient {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=password`;
  const refreshEndpoint = `${baseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=refresh_token`;
  const logoutEndpoint = `${baseUrl.replace(/\/$/, '')}/auth/v1/logout`;

  async function requestAuth(
    operation: AuthOperation,
    endpointUrl: string,
    init: RequestInit,
  ) {
    if (baseUrl && !anonKey)
      throw new AuthApiError(
        503,
        'Supabase Auth の公開鍵が設定されていません。',
      );
    const response = await fetcher(endpointUrl, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(anonKey ? { apikey: anonKey } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) throw await readError(response, operation);
    return response;
  }

  return {
    async signInWithPassword(email, password) {
      const response = await requestAuth('signIn', endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json()) as AuthResponse;
      return parseSession(body, null);
    },

    async refreshSession(refreshToken) {
      if (!refreshToken) throw new AuthApiError(400, '更新トークンがありません。');
      const response = await requestAuth('refresh', refreshEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const body = (await response.json()) as AuthResponse;
      return parseSession(body, refreshToken);
    },

    async signOut(accessToken) {
      if (!accessToken) return;
      await requestAuth('signOut', logoutEndpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    },
  };
}
