export type AuthSession = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
};

type AuthResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
};

type AuthErrorResponse = {
  error?: string;
  error_description?: string;
  msg?: string;
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
};

type AuthClientOptions = {
  baseUrl?: string;
  anonKey?: string;
  fetcher?: typeof fetch;
};

async function readError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as AuthErrorResponse;
  return new AuthApiError(
    response.status,
    body.error_description ??
      body.msg ??
      body.error ??
      'ログインに失敗しました。',
  );
}

export function createAuthClient({
  baseUrl = import.meta.env.VITE_SUPABASE_URL ?? '',
  anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
  fetcher = fetch,
}: AuthClientOptions = {}): AuthClient {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=password`;

  return {
    async signInWithPassword(email, password) {
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(anonKey ? { apikey: anonKey } : {}),
        },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw await readError(response);

      const body = (await response.json()) as AuthResponse;
      if (!body.access_token)
        throw new AuthApiError(502, '認証サーバーの応答が不正です。');
      return {
        accessToken: body.access_token,
        refreshToken: body.refresh_token ?? null,
        expiresAt: body.expires_at ?? null,
      };
    },
  };
}
