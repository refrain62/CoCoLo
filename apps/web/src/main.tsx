import type { TeamOption } from '@cocolo/contracts/auth-team-selection';
import { AppShell } from '@cocolo/ui';
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, LoginPage, useAuth } from './auth-context.js';
import { type AuthRole, createAuthContextApi } from './auth-context-api.js';
import {
  createTeamSelectionApi,
  SelectedTeamHeader,
  TeamSelectionPage,
} from './features/auth-team-selection/index.js';
import {
  getStoredSelectedTeamId,
  setStoredSelectedTeamId,
} from './features/auth-team-selection/selected-team-storage.js';
import { createEventsApi } from './features/events/events-api.js';
import { EventsPage } from './features/events/events-page.js';
import { createMemberApi } from './member-api.js';
import { MemberManagementPage } from './member-management-page.js';
import { UserManualPage } from './user-manual-page.js';
import './styles.css';

function AuthenticatedApp() {
  // 認証状態が確定するまでLoginPageを表示し、部員APIへ到達できる画面をsession保有者に限定する。
  const { session } = useAuth();
  const [selectedTeam, setSelectedTeam] = useState<TeamOption | null>(null);
  const [isResolvingTeam, setIsResolvingTeam] = useState(true);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [role, setRole] = useState<AuthRole | null>(null);
  const [eventMembers, setEventMembers] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const teamSelectionApi = useMemo(
    () =>
      createTeamSelectionApi({
        getAccessToken: () => session?.accessToken ?? null,
      }),
    [session?.accessToken],
  );
  useEffect(() => {
    if (!session) {
      setSelectedTeam(null);
      setTeamError(null);
      setIsResolvingTeam(false);
      return;
    }
    let active = true;
    setIsResolvingTeam(true);
    setTeamError(null);
    void teamSelectionApi
      .list()
      .then((teams) => {
        if (!active) return;
        const storedId = getStoredSelectedTeamId();
        const storedTeam = teams.find((team) => team.tenantId === storedId);
        const nextTeam = storedTeam ?? (teams.length === 1 ? teams[0] : null);
        if (nextTeam) setStoredSelectedTeamId(nextTeam.tenantId);
        setSelectedTeam(nextTeam ?? null);
      })
      .catch(() => {
        if (active) setTeamError('利用可能なチームを確認できません。');
      })
      .finally(() => {
        if (active) setIsResolvingTeam(false);
      });
    return () => {
      active = false;
    };
  }, [session, teamSelectionApi]);
  const selectedTeamId = selectedTeam?.tenantId ?? null;
  const memberApi = useMemo(
    () =>
      createMemberApi({
        getAccessToken: () => session?.accessToken ?? null,
        getSelectedTeamId: () => selectedTeamId,
      }),
    [selectedTeamId, session?.accessToken],
  );
  const authContextApi = useMemo(
    () =>
      createAuthContextApi({
        getAccessToken: () => session?.accessToken ?? null,
        getSelectedTeamId: () => selectedTeamId,
      }),
    [selectedTeamId, session?.accessToken],
  );
  const eventsApi = useMemo(
    () =>
      createEventsApi({
        getAccessToken: () => session?.accessToken ?? null,
        getSelectedTeamId: () => selectedTeamId,
      }),
    [selectedTeamId, session?.accessToken],
  );
  useEffect(() => {
    if (!session || !selectedTeam) return;
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
  }, [authContextApi, memberApi, selectedTeam, session]);
  if (!session) return <LoginPage />;
  if (isResolvingTeam) return <p role="status">チーム情報を確認しています。</p>;
  if (teamError) return <p role="alert">{teamError}</p>;
  if (!selectedTeam)
    return (
      <AppShell>
        <TeamSelectionPage
          api={teamSelectionApi}
          onSelected={(team) => {
            setStoredSelectedTeamId(team.tenantId);
            setSelectedTeam(team);
          }}
        />
      </AppShell>
    );

  return (
    <AppShell>
      <SelectedTeamHeader team={selectedTeam} />
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
