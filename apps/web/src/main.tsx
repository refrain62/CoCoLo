import { AppShell } from '@cocolo/ui';
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, LoginPage, useAuth } from './auth-context.js';
import { type AuthRole, createAuthContextApi } from './auth-context-api.js';
import { createEventsApi } from './features/events/events-api.js';
import { EventsPage } from './features/events/events-page.js';
import { createMemberApi } from './member-api.js';
import { MemberManagementPage } from './member-management-page.js';
import { UserManualPage } from './user-manual-page.js';
import './styles.css';

function AuthenticatedApp() {
  // 認証状態が確定するまでLoginPageを表示し、部員APIへ到達できる画面をsession保有者に限定する。
  const { session } = useAuth();
  const [role, setRole] = useState<AuthRole | null>(null);
  const [eventMembers, setEventMembers] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const memberApi = useMemo(
    () =>
      createMemberApi({
        getAccessToken: () => session?.accessToken ?? null,
      }),
    [session?.accessToken],
  );
  const authContextApi = useMemo(
    () =>
      createAuthContextApi({
        getAccessToken: () => session?.accessToken ?? null,
      }),
    [session?.accessToken],
  );
  const eventsApi = useMemo(
    () =>
      createEventsApi({
        getAccessToken: () => session?.accessToken ?? null,
      }),
    [session?.accessToken],
  );
  useEffect(() => {
    if (!session) return;
    let active = true;
    setRole(null);
    setEventsError(null);
    void Promise.all([
      authContextApi.get(),
      memberApi.listAll({ q: '', category: '', status: 'active' }),
    ])
      .then(([context, members]) => {
        if (!active) return;
        setRole(context.role);
        setEventMembers(
          members.map((member) => ({ id: member.id, name: member.name })),
        );
      })
      .catch(() => {
        if (active) setEventsError('予定画面の利用権限を確認できません。');
      });
    return () => {
      active = false;
    };
  }, [authContextApi, memberApi, session]);
  if (!session) return <LoginPage />;

  return (
    <AppShell>
      <nav aria-label="ヘルプ">
        <a href="/manual">操作マニュアル</a>
      </nav>
      <MemberManagementPage api={memberApi} />
      {eventsError ? <p role="alert">{eventsError}</p> : null}
      {role ? (
        <EventsPage api={eventsApi} role={role} memberOptions={eventMembers} />
      ) : null}
    </AppShell>
  );
}

function App() {
  // マニュアルは認証情報やチームデータを含まないため、ログイン前にも公開する。
  if (window.location.pathname === '/manual')
    return (
      <AppShell>
        <UserManualPage />
      </AppShell>
    );

  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('root element is missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
