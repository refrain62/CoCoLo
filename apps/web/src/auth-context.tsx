import {
  createContext,
  type FormEvent,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  type AuthClient,
  type AuthSession,
  createAuthClient,
} from './auth-client.js';

type AuthContextValue = {
  session: AuthSession | null;
  isSigningIn: boolean;
  isRefreshing: boolean;
  isLoggingOut: boolean;
  requiresReauthentication: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
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

export class AuthSessionError extends Error {
  readonly status = 401;

  constructor(message = 'ログインが必要です。') {
    super(message);
    this.name = 'AuthSessionError';
  }
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
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
  storage = getBrowserStorage(),
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

// access tokenとrefresh tokenを復元し、再読み込み後も期限前更新を再開できるようにする。
function getStoredSession(): AuthSession | null {
  return readStoredSession(getBrowserStorage());
}

export function AuthProvider({
  children,
  client = defaultAuthClient,
}: PropsWithChildren<{ client?: AuthClient }>) {
  const [session, setSession] = useState<AuthSession | null>(getStoredSession);
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

  const signIn = useCallback(
    async (email: string, password: string) => {
      setIsSigningIn(true);
      setError(null);
      setRequiresReauthentication(false);
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
      isSigningIn,
      isRefreshing,
      isLoggingOut,
      requiresReauthentication,
      error,
      signIn,
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
      refreshSession,
      requiresReauthentication,
      session,
      signIn,
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
export function LoginPage() {
  const { error, isSigningIn, signIn } = useAuth();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await signIn(
      String(form.get('email') ?? '').trim(),
      String(form.get('password') ?? ''),
    );
  }

  return (
    <main>
      <h1>CoCoLo ログイン</h1>
      <form onSubmit={submit}>
        <div>
          <label htmlFor="auth-email">メールアドレス</label>
          <input id="auth-email" name="email" required type="email" />
        </div>
        <div>
          <label htmlFor="auth-password">パスワード</label>
          <input id="auth-password" name="password" required type="password" />
        </div>
        {error ? <p role="alert">{error}</p> : null}
        <button disabled={isSigningIn} type="submit">
          {isSigningIn ? 'ログイン中…' : 'ログイン'}
        </button>
      </form>
      <p>
        <a href="/manual">操作マニュアルを確認</a>
      </p>
    </main>
  );
}
