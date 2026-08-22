import {
  createContext,
  type FormEvent,
  type PropsWithChildren,
  useContext,
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
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const defaultAuthClient = createAuthClient();

function getStoredSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  const accessToken = window.localStorage.getItem('cocolo.accessToken');
  return accessToken
    ? { accessToken, refreshToken: null, expiresAt: null }
    : null;
}

export function AuthProvider({
  children,
  client = defaultAuthClient,
}: PropsWithChildren<{ client?: AuthClient }>) {
  const [session, setSession] = useState<AuthSession | null>(getStoredSession);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isSigningIn,
      error,
      async signIn(email, password) {
        setIsSigningIn(true);
        setError(null);
        try {
          const nextSession = await client.signInWithPassword(email, password);
          if (typeof window !== 'undefined')
            window.localStorage.setItem(
              'cocolo.accessToken',
              nextSession.accessToken,
            );
          setSession(nextSession);
        } catch (requestError) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'ログインに失敗しました。',
          );
        } finally {
          setIsSigningIn(false);
        }
      },
    }),
    [client, error, isSigningIn, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProviderが必要です。');
  return context;
}

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
