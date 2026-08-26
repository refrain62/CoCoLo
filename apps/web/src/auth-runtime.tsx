import { AppShell } from '@cocolo/ui';
import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AuthProvider, LoginPage, useAuth } from './auth-context.js';
import { createAuthInvitationApi } from './features/auth-invitations/auth-invitation-api.js';
import {
  InvitationAcceptPage,
  isInvitationPath,
  readInvitationToken,
} from './features/auth-invitations/auth-invitation-page.js';
import { setStoredSelectedTeamId } from './features/auth-team-selection/selected-team-storage.js';

const AuthenticatedApp = lazy(() =>
  import('./authenticated-app.js').then(({ AuthenticatedApp: app }) => ({
    default: app,
  })),
);

function AuthenticatedLoading() {
  return (
    <AppShell>
      <section className="app-state-card" aria-live="polite" role="status">
        管理画面を準備しています。
      </section>
    </AppShell>
  );
}

function AuthBoundary({ publicRoot }: { publicRoot?: ReactNode }) {
  const { authenticatedFetch, session } = useAuth();
  const [pathname, setPathname] = useState(() =>
    typeof window === 'undefined' ? '' : window.location.pathname,
  );
  const [invitationToken, setInvitationToken] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : readInvitationToken(),
  );

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    setInvitationToken(
      isInvitationPath(pathname) ? readInvitationToken(pathname) : null,
    );
  }, [pathname]);

  const invitationApi = useMemo(
    () =>
      createAuthInvitationApi({
        fetcher: authenticatedFetch,
      }),
    [authenticatedFetch],
  );

  if (isInvitationPath(pathname))
    return (
      <InvitationAcceptPage
        api={invitationApi}
        onAccepted={(tenantId) => {
          setStoredSelectedTeamId(tenantId);
          window.history.replaceState(null, document.title, '/admin');
          setPathname('/admin');
        }}
        token={invitationToken}
      />
    );

  if (!session) return publicRoot ?? <LoginPage />;

  return (
    <Suspense fallback={<AuthenticatedLoading />}>
      <AuthenticatedApp />
    </Suspense>
  );
}

// 認証状態だけを先に確定し、管理画面のコードは認証済みのときだけ遅延読込する。
export function AuthRuntime({ publicRoot }: { publicRoot?: ReactNode }) {
  return (
    <AuthProvider>
      <AuthBoundary publicRoot={publicRoot} />
    </AuthProvider>
  );
}
