import { AppShell, CoCoLoLogoMark } from '@cocolo/ui';
import {
  createContext,
  type FormEvent,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type AuthClient,
  type AuthSession,
  createAuthClient,
  createOAuthTransaction,
  type OAuthProvider,
  type OAuthTransaction,
} from './auth-client.js';

type OAuthSignInOptions = { invitationToken?: string };

export type LoginMode = 'team' | 'system';

type AuthContextValue = {
  session: AuthSession | null;
  oauthProvider: OAuthProvider | null;
  oauthInvitationTokenHash: string | null;
  isSigningIn: boolean;
  isRefreshing: boolean;
  isLoggingOut: boolean;
  requiresReauthentication: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithOAuth: (
    provider: OAuthProvider,
    options?: OAuthSignInOptions,
  ) => Promise<void>;
  refreshSession: () => Promise<AuthSession | null>;
  logout: () => Promise<void>;
  authenticatedFetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type SessionListener = (session: AuthSession | null) => void;

const AuthContext = createContext<AuthContextValue | null>(null);
const defaultAuthClient = createAuthClient();
const STORAGE_KEYS = {
  accessToken: 'cocolo.accessToken',
  refreshToken: 'cocolo.refreshToken',
  expiresAt: 'cocolo.expiresAt',
} as const;
const REFRESH_SKEW_SECONDS = 60;
const OAUTH_TRANSACTION_KEY = 'cocolo.oauthTransaction';
const OAUTH_TRANSACTION_MAX_AGE_MS = 10 * 60 * 1000;
const OAUTH_CALLBACK_PATH = '/auth/callback';
const OAUTH_CREDENTIAL_PARAMS = [
  'access_token',
  'refresh_token',
  'id_token',
  'token_type',
  'expires_in',
  'expires_at',
] as const;

export function validateOAuthCallback(
  transaction: OAuthTransaction | null,
  params: URLSearchParams,
  now = Date.now(),
) {
  const state = params.get('state');
  const code = params.get('code');
  const callbackNonce = params.get('nonce');
  // Supabase AuthのPKCE code exchangeがprovider ID tokenのnonceを検証する（docs/integration/oauth-security.md）ため、callback queryへのnonce反映は任意です。
  return Boolean(
    transaction &&
      code &&
      state &&
      state === transaction.state &&
      (callbackNonce === null || callbackNonce === transaction.nonce) &&
      now >= transaction.createdAt &&
      now - transaction.createdAt <= OAUTH_TRANSACTION_MAX_AGE_MS,
  );
}

export class AuthSessionError extends Error {
  readonly status = 401;

  constructor(message = 'ログインが必要です。') {
    super(message);
    this.name = 'AuthSessionError';
  }
}

function readStoredSession(storage: StorageLike | null): AuthSession | null {
  if (!storage) return null;
  try {
    const accessToken = storage.getItem(STORAGE_KEYS.accessToken);
    if (!accessToken) return null;
    const refreshToken = storage.getItem(STORAGE_KEYS.refreshToken);
    const expiresAtValue = storage.getItem(STORAGE_KEYS.expiresAt);
    const parsedExpiresAt = expiresAtValue ? Number(expiresAtValue) : NaN;
    return {
      accessToken,
      refreshToken: refreshToken || null,
      expiresAt: Number.isFinite(parsedExpiresAt) ? parsedExpiresAt : null,
    };
  } catch {
    return null;
  }
}

function persistSession(storage: StorageLike | null, session: AuthSession) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEYS.accessToken, session.accessToken);
    if (session.refreshToken)
      storage.setItem(STORAGE_KEYS.refreshToken, session.refreshToken);
    else storage.removeItem(STORAGE_KEYS.refreshToken);
    if (session.expiresAt === null) storage.removeItem(STORAGE_KEYS.expiresAt);
    else storage.setItem(STORAGE_KEYS.expiresAt, String(session.expiresAt));
  } catch {
    // 保存先が利用できない場合も、現在のタブ内のsessionはメモリで維持する。
  }
}

function clearPersistedSession(storage: StorageLike | null) {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEYS.accessToken);
    storage.removeItem(STORAGE_KEYS.refreshToken);
    storage.removeItem(STORAGE_KEYS.expiresAt);
  } catch {
    // logout時は保存先の例外を画面へ渡さず、メモリ上のsessionを先に消去する。
  }
}

function getOAuthStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function saveOAuthTransaction(
  transaction: Awaited<ReturnType<typeof createOAuthTransaction>>,
): boolean {
  try {
    const storage = getOAuthStorage();
    if (!storage) return false;
    storage.setItem(OAUTH_TRANSACTION_KEY, JSON.stringify(transaction));
    return true;
  } catch {
    // OAuth transactionを保存できない環境ではredirectせず、fail-closedにする。
    return false;
  }
}

function readOAuthTransaction() {
  let raw: string | null = null;
  try {
    raw = getOAuthStorage()?.getItem(OAUTH_TRANSACTION_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      (value.provider !== 'google' && value.provider !== 'line') ||
      typeof value.redirectTo !== 'string' ||
      typeof value.returnTo !== 'string' ||
      !isSafeOAuthReturnPath(value.returnTo) ||
      !isOAuthValue(value.state) ||
      !isOAuthValue(value.nonce) ||
      !isOAuthValue(value.codeVerifier) ||
      !isOAuthValue(value.codeChallenge) ||
      (value.invitationTokenHash !== null &&
        !isOAuthValue(value.invitationTokenHash)) ||
      value.codeChallengeMethod !== 'S256' ||
      typeof value.createdAt !== 'number' ||
      !Number.isFinite(value.createdAt)
    )
      return null;
    return value as Awaited<ReturnType<typeof createOAuthTransaction>>;
  } catch {
    return null;
  }
}

function isSafeOAuthReturnPath(value: string) {
  return (
    value.length <= 2048 &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\')
  );
}

function isOAuthValue(value: unknown) {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    value.length <= 256 &&
    /^[A-Za-z0-9_-]+$/u.test(value)
  );
}

function clearOAuthTransaction() {
  try {
    getOAuthStorage()?.removeItem(OAUTH_TRANSACTION_KEY);
  } catch {
    // callback検証後のcleanup失敗はtoken受入可否へ影響させない。
  }
}

function clearOAuthCallbackUrl() {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  try {
    window.history.replaceState(null, document.title, url.pathname);
    return true;
  } catch {
    // queryを残したままcode交換へ進まず、再読み込みで秘密情報をURLから除去する。
    try {
      window.location.replace(url.pathname);
    } catch {
      window.location.hash = '';
    }
    return false;
  }
}

function getOAuthRedirectTo() {
  return `${window.location.origin}${OAUTH_CALLBACK_PATH}`;
}

function getOAuthReturnTo() {
  return window.location.pathname;
}

export function containsOAuthCredential(search: string, hash: string) {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/u, ''));
  return OAUTH_CREDENTIAL_PARAMS.some(
    (key) => query.has(key) || fragment.has(key),
  );
}

function canReplayRequest(init?: RequestInit) {
  const body = init?.body;
  if (body === undefined || body === null || typeof body === 'string')
    return true;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams)
    return true;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return true;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return true;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return true;
  return false;
}

export type AuthSessionManager = {
  getSession: () => AuthSession | null;
  subscribe: (listener: SessionListener) => () => void;
  signIn: (email: string, password: string) => Promise<AuthSession>;
  adoptSession: (session: AuthSession) => void;
  refresh: (expectedAccessToken?: string) => Promise<AuthSession | null>;
  authenticatedFetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  logout: () => Promise<void>;
  start: () => void;
  stop: () => void;
};

type AuthSessionManagerOptions = {
  client: AuthClient;
  storage?: StorageLike | null;
  requester?: typeof fetch;
  now?: () => number;
  refreshSkewSeconds?: number;
  onSessionExpired?: () => void;
};

// sessionの保存、期限前更新、401後の一回だけの再試行を一つの状態機械へ集約する。
// refreshInFlightは同じrefresh tokenを使う更新を単一化し、Supabaseのtoken rotation競合を防ぐ。
export function createAuthSessionManager({
  client,
  // 本番のsessionはメモリだけで保持する。storageはテストまたは明示的な安全なadapterの注入に限定する。
  storage = null,
  requester = fetch,
  now = Date.now,
  refreshSkewSeconds = REFRESH_SKEW_SECONDS,
  onSessionExpired,
}: AuthSessionManagerOptions): AuthSessionManager {
  let current = readStoredSession(storage);
  let refreshInFlight: Promise<AuthSession | null> | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let expiredNotificationSent = false;
  const listeners = new Set<SessionListener>();

  function notify() {
    for (const listener of listeners) listener(current);
  }

  function scheduleRefresh() {
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    refreshTimer = undefined;
    if (!current?.refreshToken || current.expiresAt === null) return;
    const delay = Math.max(
      0,
      current.expiresAt * 1000 - now() - refreshSkewSeconds * 1000,
    );
    const expectedAccessToken = current.accessToken;
    refreshTimer = setTimeout(() => {
      void refresh(expectedAccessToken).then(scheduleRefresh);
    }, delay);
  }

  function setSession(next: AuthSession) {
    current = next;
    expiredNotificationSent = false;
    persistSession(storage, next);
    notify();
    scheduleRefresh();
  }

  function clearSession(expired = false) {
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    refreshTimer = undefined;
    refreshInFlight = null;
    current = null;
    clearPersistedSession(storage);
    notify();
    if (expired && !expiredNotificationSent) {
      expiredNotificationSent = true;
      onSessionExpired?.();
    }
  }

  async function refresh(expectedAccessToken?: string) {
    const observed = current;
    if (!observed) return null;
    if (expectedAccessToken && observed.accessToken !== expectedAccessToken)
      return observed;
    if (refreshInFlight) return refreshInFlight;
    if (!observed.refreshToken) {
      clearSession(true);
      return null;
    }

    const refreshToken = observed.refreshToken;
    const promise = (async () => {
      try {
        const next = await client.refreshSession(refreshToken);
        // logoutや再ログインが先に完了していたら、古いrefresh結果でsessionを復活させない。
        if (!current || current.accessToken !== observed.accessToken)
          return current;
        setSession(next);
        return next;
      } catch {
        if (current?.accessToken === observed.accessToken) clearSession(true);
        return null;
      }
    })();
    refreshInFlight = promise;
    void promise.finally(() => {
      if (refreshInFlight === promise) refreshInFlight = null;
      scheduleRefresh();
    });
    return promise;
  }

  async function ensureFreshSession() {
    if (!current) return null;
    if (
      current.expiresAt !== null &&
      current.expiresAt <= (now() + refreshSkewSeconds * 1000) / 1000
    )
      return refresh(current.accessToken);
    return current;
  }

  async function authenticatedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ) {
    const active = await ensureFreshSession();
    if (!active) throw new AuthSessionError();

    async function requestWithToken(accessToken: string) {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${accessToken}`);
      return requester(input, { ...init, headers });
    }

    const response = await requestWithToken(active.accessToken);
    if (response.status !== 401) return response;

    const refreshed = await refresh(active.accessToken);
    if (!refreshed || !canReplayRequest(init)) return response;
    return requestWithToken(refreshed.accessToken);
  }

  async function signIn(email: string, password: string) {
    try {
      const next = await client.signInWithPassword(email, password);
      setSession(next);
      return next;
    } catch {
      throw new Error('ログインに失敗しました。');
    }
  }

  async function logout() {
    const accessToken = current?.accessToken;
    // リモートlogoutの成否にかかわらず、画面と保存領域から先にsessionを消去する。
    clearSession();
    if (!accessToken) return;
    try {
      await client.signOut(accessToken);
    } catch {
      throw new Error('ログアウトに失敗しました。');
    }
  }

  return {
    getSession: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    signIn,
    adoptSession: setSession,
    refresh,
    authenticatedFetch,
    logout,
    start: scheduleRefresh,
    stop() {
      if (refreshTimer !== undefined) clearTimeout(refreshTimer);
      refreshTimer = undefined;
    },
  };
}

export function AuthProvider({
  children,
  client = defaultAuthClient,
}: PropsWithChildren<{ client?: AuthClient }>) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [oauthProvider, setOAuthProvider] = useState<OAuthProvider | null>(
    null,
  );
  const [oauthInvitationTokenHash, setOAuthInvitationTokenHash] = useState<
    string | null
  >(null);
  const oauthCallbackHandled = useRef(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [requiresReauthentication, setRequiresReauthentication] =
    useState(false);
  const [error, setError] = useState<string | null>(null);
  const manager = useMemo(
    () =>
      createAuthSessionManager({
        client,
        onSessionExpired: () => {
          setRequiresReauthentication(true);
          setError(
            'セッションの有効期限が切れました。再ログインしてください。',
          );
        },
      }),
    [client],
  );

  useEffect(() => {
    const unsubscribe = manager.subscribe(setSession);
    manager.start();
    return () => {
      unsubscribe();
      manager.stop();
    };
  }, [manager]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (oauthCallbackHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const hasCodeCallback = params.has('code') || params.has('error');
    const hasCredentialCallback = containsOAuthCredential(
      window.location.search,
      window.location.hash,
    );
    const hasCallbackPathParameters =
      window.location.pathname === OAUTH_CALLBACK_PATH &&
      (window.location.search.length > 0 || window.location.hash.length > 0);
    if (
      !hasCodeCallback &&
      !hasCredentialCallback &&
      !hasCallbackPathParameters
    )
      return;
    oauthCallbackHandled.current = true;
    setOAuthProvider(null);
    setOAuthInvitationTokenHash(null);
    const transaction = readOAuthTransaction();
    clearOAuthTransaction();
    if (!clearOAuthCallbackUrl()) {
      setError('OAuthログインを完了できませんでした。再度お試しください。');
      return;
    }
    if (!hasCodeCallback) {
      setError('OAuthログインを完了できませんでした。再度お試しください。');
      return;
    }
    async function completeOAuth() {
      const code = params.get('code');
      if (
        !transaction ||
        transaction.redirectTo !== getOAuthRedirectTo() ||
        !validateOAuthCallback(transaction, params)
      ) {
        setError('OAuthログインの確認情報が無効です。');
        return;
      }
      if (!code || !client.exchangeOAuthCode) {
        setError('OAuthログインを完了できませんでした。');
        return;
      }
      try {
        const callbackSession = await client.exchangeOAuthCode(
          code,
          transaction.codeVerifier,
          transaction.redirectTo,
        );
        manager.adoptSession(callbackSession);
        setOAuthProvider(transaction.provider);
        setOAuthInvitationTokenHash(transaction.invitationTokenHash);
        window.history.replaceState(null, document.title, transaction.returnTo);
        window.dispatchEvent(new PopStateEvent('popstate'));
      } catch {
        setError('OAuthログインを完了できませんでした。');
      }
    }
    void completeOAuth();
  }, [client, manager]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setIsSigningIn(true);
      setError(null);
      setRequiresReauthentication(false);
      setOAuthProvider(null);
      setOAuthInvitationTokenHash(null);
      try {
        await manager.signIn(email, password);
      } catch {
        setError('ログインに失敗しました。');
      } finally {
        setIsSigningIn(false);
      }
    },
    [manager],
  );

  const signInWithOAuth = useCallback(
    async (provider: OAuthProvider, options?: OAuthSignInOptions) => {
      if (!client.getOAuthAuthorizeUrl) {
        setError('OAuthログインが設定されていません。');
        return;
      }
      if (typeof window === 'undefined') {
        setError('OAuthログインを開始できません。');
        return;
      }
      setError(null);
      setOAuthProvider(null);
      setOAuthInvitationTokenHash(null);
      try {
        const redirectTo = getOAuthRedirectTo();
        const transaction = await createOAuthTransaction(
          provider,
          redirectTo,
          getOAuthReturnTo(),
          options?.invitationToken,
        );
        if (!saveOAuthTransaction(transaction)) {
          setError('OAuthログインを開始できません。');
          return;
        }
        window.location.assign(
          client.getOAuthAuthorizeUrl(provider, redirectTo, transaction),
        );
      } catch {
        setError('OAuthログインを開始できません。');
      }
    },
    [client],
  );

  const refreshSession = useCallback(async () => {
    setIsRefreshing(true);
    try {
      return await manager.refresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [manager]);

  const logout = useCallback(async () => {
    setIsLoggingOut(true);
    setError(null);
    setOAuthProvider(null);
    setOAuthInvitationTokenHash(null);
    try {
      await manager.logout();
    } catch {
      setError('ログアウトに失敗しました。');
    } finally {
      setIsLoggingOut(false);
    }
  }, [manager]);

  const authenticatedFetch = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) =>
      manager.authenticatedFetch(input, init),
    [manager],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      oauthProvider,
      oauthInvitationTokenHash,
      isSigningIn,
      isRefreshing,
      isLoggingOut,
      requiresReauthentication,
      error,
      signIn,
      signInWithOAuth,
      refreshSession,
      logout,
      authenticatedFetch,
    }),
    [
      authenticatedFetch,
      error,
      isLoggingOut,
      isRefreshing,
      isSigningIn,
      logout,
      oauthInvitationTokenHash,
      oauthProvider,
      refreshSession,
      requiresReauthentication,
      session,
      signIn,
      signInWithOAuth,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Provider外からの利用を設定漏れとして即時に検出する。
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProviderが必要です。');
  return context;
}

// 入力値をtrimしてAuth clientへ渡し、認証情報そのものは画面へ表示しない。
export function LoginPage({ mode = 'team' }: { mode?: LoginMode }) {
  const { error, isSigningIn, signIn, signInWithOAuth } = useAuth();
  const isSystemAdmin = mode === 'system';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await signIn(
      String(form.get('email') ?? '').trim(),
      String(form.get('password') ?? ''),
    );
  }

  return (
    <AppShell
      className={isSystemAdmin ? 'auth-shell system-auth-shell' : 'auth-shell'}
      nav={null}
    >
      <section className="auth-card" aria-labelledby="auth-heading">
        <div className="auth-card-brand" aria-hidden="true">
          <CoCoLoLogoMark />
          <span>CoCoLo</span>
        </div>
        <p className="auth-eyebrow">
          {isSystemAdmin ? 'SYSTEM ADMIN' : 'TEAM LOGIN'}
        </p>
        <h1 id="auth-heading">
          {isSystemAdmin ? 'システム管理者ログイン' : 'チームログイン'}
        </h1>
        <p className="auth-lead">
          {isSystemAdmin
            ? 'CoCoLo全体のお知らせと提供機能を管理します。'
            : '予定、出欠、連絡、チーム運営をひとつの場所で確認できます。'}
        </p>
        <form onSubmit={submit}>
          <div>
            <label htmlFor="auth-email">メールアドレス</label>
            <input id="auth-email" name="email" required type="email" />
          </div>
          <div>
            <label htmlFor="auth-password">パスワード</label>
            <input
              id="auth-password"
              name="password"
              required
              type="password"
            />
          </div>
          {error ? <p role="alert">{error}</p> : null}
          <button disabled={isSigningIn} type="submit">
            {isSigningIn ? 'ログイン中…' : 'ログイン'}
          </button>
        </form>
        <fieldset className="auth-provider-actions">
          <legend>OAuthでログイン</legend>
          <button type="button" onClick={() => void signInWithOAuth('line')}>
            LINEでログイン
          </button>
          <button type="button" onClick={() => void signInWithOAuth('google')}>
            Googleでログイン
          </button>
        </fieldset>
        <p className="auth-help">
          {isSystemAdmin ? (
            <>
              この入口はシステム管理者専用です。
              <br />
              <a href="/login">チームログインはこちら</a>
            </>
          ) : (
            <a href="/manual">操作マニュアルを確認</a>
          )}
        </p>
      </section>
    </AppShell>
  );
}
