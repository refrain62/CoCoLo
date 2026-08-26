export type AuthSession = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
};

export type OAuthProvider = 'google' | 'line';

export type OAuthAuthorizeOptions = {
  state: string;
  nonce: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
};

type AuthResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
};

export type OAuthTransaction = OAuthAuthorizeOptions & {
  provider: OAuthProvider;
  redirectTo: string;
  returnTo: string;
  invitationTokenHash: string | null;
  codeVerifier: string;
  createdAt: number;
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
  getOAuthAuthorizeUrl?: (
    provider: OAuthProvider,
    redirectTo: string,
    options: OAuthAuthorizeOptions,
  ) => string;
  exchangeOAuthCode?: (
    code: string,
    codeVerifier: string,
    redirectTo: string,
  ) => Promise<AuthSession>;
  refreshSession: (refreshToken: string) => Promise<AuthSession>;
  signOut: (accessToken: string) => Promise<void>;
};

type AuthClientOptions = {
  baseUrl?: string;
  anonKey?: string;
  fetcher?: typeof fetch;
};

type AuthOperation = 'signIn' | 'refresh' | 'signOut' | 'oauth';

function getErrorMessage(operation: AuthOperation, status: number) {
  if (operation === 'signIn' && (status === 400 || status === 401))
    return 'メールアドレスまたはパスワードを確認してください。';
  if (operation === 'refresh')
    return 'セッションを更新できませんでした。再ログインしてください。';
  if (operation === 'signOut') return 'ログアウトに失敗しました。';
  if (operation === 'oauth')
    return 'OAuthログインを完了できませんでした。再度お試しください。';
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

function toBase64Url(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');
}

function randomBase64Url(byteLength = 32) {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues)
    throw new AuthApiError(503, 'OAuthログインを開始できません。');
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function assertOAuthProvider(provider: OAuthProvider) {
  if (provider !== 'google' && provider !== 'line')
    throw new AuthApiError(400, 'OAuth providerが不正です。');
}

export async function hashOAuthBinding(value: string) {
  if (typeof crypto === 'undefined' || !crypto.subtle)
    throw new AuthApiError(503, 'OAuthログインを開始できません。');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return toBase64Url(digest);
}

// OAuthはimplicit flowを使わず、state・nonce・PKCEを一つの短期transactionとして扱う。
export async function createOAuthTransaction(
  provider: OAuthProvider,
  redirectTo: string,
  returnTo: string,
  invitationToken?: string,
): Promise<OAuthTransaction> {
  assertOAuthProvider(provider);
  const state = randomBase64Url();
  const nonce = randomBase64Url();
  const codeVerifier = randomBase64Url(48);
  if (typeof crypto === 'undefined' || !crypto.subtle)
    throw new AuthApiError(503, 'OAuthログインを開始できません。');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(codeVerifier),
  );
  return {
    provider,
    redirectTo,
    returnTo,
    invitationTokenHash: invitationToken
      ? await hashOAuthBinding(invitationToken)
      : null,
    state,
    nonce,
    codeVerifier,
    codeChallenge: toBase64Url(digest),
    codeChallengeMethod: 'S256',
    createdAt: Date.now(),
  };
}

// 旧implicit callbackはtokenをURL hashへ露出するため、互換受入せず安全側へ倒す。
export function parseOAuthCallback(hash: string): AuthSession | null {
  void hash;
  return null;
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
  const oauthCodeEndpoint = `${baseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=pkce`;
  const logoutEndpoint = `${baseUrl.replace(/\/$/, '')}/auth/v1/logout`;
  const authorizeEndpoint = `${baseUrl.replace(/\/$/, '')}/auth/v1/authorize`;

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
    let response: Response;
    try {
      response = await fetcher(endpointUrl, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(anonKey ? { apikey: anonKey } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new AuthApiError(0, getErrorMessage(operation, 0));
    }
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

    getOAuthAuthorizeUrl(provider, redirectTo, options) {
      assertOAuthProvider(provider);
      const endpoint = baseUrl ? authorizeEndpoint : '/auth/v1/authorize';
      const params = new URLSearchParams({
        provider,
        redirect_to: redirectTo,
        state: options.state,
        nonce: options.nonce,
        code_challenge: options.codeChallenge,
        code_challenge_method: options.codeChallengeMethod,
      });
      return `${endpoint}?${params.toString()}`;
    },

    async exchangeOAuthCode(code, codeVerifier, redirectTo) {
      const response = await requestAuth('oauth', oauthCodeEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_code: code,
          code_verifier: codeVerifier,
          redirect_uri: redirectTo,
        }),
      });
      return parseSession((await response.json()) as AuthResponse, null);
    },

    async refreshSession(refreshToken) {
      if (!refreshToken)
        throw new AuthApiError(400, '更新トークンがありません。');
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
