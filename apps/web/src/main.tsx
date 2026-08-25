import type { TeamOption } from '@cocolo/contracts/auth-team-selection';
import { AppShell } from '@cocolo/ui';
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, LoginPage, useAuth } from './auth-context.js';
import { type AuthRole, createAuthContextApi } from './auth-context-api.js';
import { createAttachmentApi } from './features/attachments/attachment-api.js';
import { AttachmentUploader } from './features/attachments/attachment-uploader.js';
import { createAuthInvitationApi } from './features/auth-invitations/auth-invitation-api.js';
import {
  InvitationAcceptPage,
  isInvitationPath,
  readInvitationToken,
} from './features/auth-invitations/auth-invitation-page.js';
import {
  createTeamSelectionApi,
  SelectedTeamHeader,
  TeamSelectionPage,
} from './features/auth-team-selection/index.js';
import {
  clearStoredSelectedTeamId,
  getStoredSelectedTeamId,
  setStoredSelectedTeamId,
} from './features/auth-team-selection/selected-team-storage.js';
import { createBoardContactApi } from './features/board-contact/board-contact-api.js';
import { BoardContactPage } from './features/board-contact/board-contact-page.js';
import { createBulletinBoardApi } from './features/bulletin-board/bulletin-board-api.js';
import { BulletinBoardPage } from './features/bulletin-board/bulletin-board-page.js';
import { createEventsApi } from './features/events/events-api.js';
import { EventsPage } from './features/events/events-page.js';
import { LineNotificationPanel } from './features/line-notifications/line-notification-panel.js';
import { createLineNotificationApi } from './features/line-notifications/line-notifications-api.js';
import {
  createOrdersPaymentsApi,
  OrdersPaymentsPage,
} from './features/orders-payments/index.js';
import { createRideOperationsApi } from './features/ride-operations/ride-operations-api.js';
import { RideOperationsPanel } from './features/ride-operations/ride-operations-panel.js';
import { createMemberApi } from './member-api.js';
import { MemberManagementPage } from './member-management-page.js';
import { UserManualPage } from './user-manual-page.js';
import './styles.css';

function AuthenticatedApp() {
  // 認証状態が確定するまでLoginPageを表示し、部員APIへ到達できる画面をsession保有者に限定する。
  const { authenticatedFetch, isLoggingOut, logout, session } = useAuth();
  const [selectedTeam, setSelectedTeam] = useState<TeamOption | null>(null);
  const [isResolvingTeam, setIsResolvingTeam] = useState(true);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [role, setRole] = useState<AuthRole | null>(null);
  const [eventMembers, setEventMembers] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [invitationToken, setInvitationToken] = useState<string | null>(() =>
    readInvitationToken(),
  );
  const teamSelectionApi = useMemo(
    () =>
      createTeamSelectionApi({
        getAccessToken: () => session?.accessToken ?? null,
        fetcher: authenticatedFetch,
      }),
    [authenticatedFetch, session?.accessToken],
  );
  useEffect(() => {
    if (!session) {
      clearStoredSelectedTeamId();
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
  const authInvitationApi = useMemo(
    () =>
      createAuthInvitationApi({
        fetcher: authenticatedFetch,
        getSelectedTeamId: () => selectedTeamId,
      }),
    [authenticatedFetch, selectedTeamId],
  );
  const memberApi = useMemo(
    () =>
      createMemberApi({
        getAccessToken: () => session?.accessToken ?? null,
        getSelectedTeamId: () => selectedTeamId,
        fetcher: authenticatedFetch,
      }),
    [authenticatedFetch, selectedTeamId, session?.accessToken],
  );
  const authContextApi = useMemo(
    () =>
      createAuthContextApi({
        getAccessToken: () => session?.accessToken ?? null,
        getSelectedTeamId: () => selectedTeamId,
        fetcher: authenticatedFetch,
      }),
    [authenticatedFetch, selectedTeamId, session?.accessToken],
  );
  const eventsApi = useMemo(
    () =>
      createEventsApi({
        getAccessToken: () => session?.accessToken ?? null,
        getSelectedTeamId: () => selectedTeamId,
        fetcher: authenticatedFetch,
      }),
    [authenticatedFetch, selectedTeamId, session?.accessToken],
  );
  const boardContactApi = useMemo(
    () =>
      createBoardContactApi({
        getAccessToken: () => session?.accessToken ?? null,
        getSelectedTeamId: () => selectedTeamId,
        fetcher: authenticatedFetch,
      }),
    [authenticatedFetch, selectedTeamId, session?.accessToken],
  );
  const bulletinBoardApi = useMemo(
    () =>
      createBulletinBoardApi({
        getAccessToken: () => session?.accessToken ?? null,
        getSelectedTeamId: () => selectedTeamId,
        fetcher: authenticatedFetch,
      }),
    [authenticatedFetch, selectedTeamId, session?.accessToken],
  );
  const attachmentApi = useMemo(
    () =>
      createAttachmentApi({
        getAccessToken: () => session?.accessToken ?? null,
        getSelectedTeamId: () => selectedTeamId,
        fetcher: authenticatedFetch,
      }),
    [authenticatedFetch, selectedTeamId, session?.accessToken],
  );
  const lineNotificationApi = useMemo(
    () =>
      createLineNotificationApi({
        getAccessToken: () => session?.accessToken ?? null,
        getSelectedTeamId: () => selectedTeamId,
        fetcher: authenticatedFetch,
      }),
    [authenticatedFetch, selectedTeamId, session?.accessToken],
  );
  const ordersApi = useMemo(
    () =>
      createOrdersPaymentsApi({
        getAccessToken: () => session?.accessToken ?? null,
        getSelectedTeamId: () => selectedTeamId,
        fetcher: authenticatedFetch,
      }),
    [authenticatedFetch, selectedTeamId, session?.accessToken],
  );
  const rideApi = useMemo(
    () =>
      createRideOperationsApi({
        getAccessToken: () => session?.accessToken ?? null,
        getSelectedTeamId: () => selectedTeamId,
        fetcher: authenticatedFetch,
      }),
    [authenticatedFetch, selectedTeamId, session?.accessToken],
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
  if (isInvitationPath(window.location.pathname))
    return (
      <InvitationAcceptPage
        api={authInvitationApi}
        onAccepted={(tenantId) => {
          window.history.replaceState(null, document.title, '/');
          setInvitationToken(null);
          setSelectedTeam(null);
          setTeamError(null);
          setIsResolvingTeam(true);
          void teamSelectionApi
            .list()
            .then((teams) => {
              const nextTeam = teams.find((team) => team.tenantId === tenantId);
              if (nextTeam) {
                setStoredSelectedTeamId(nextTeam.tenantId);
                setSelectedTeam(nextTeam);
              } else {
                setTeamError('連携したチームを確認できません。');
              }
            })
            .catch(() => setTeamError('利用可能なチームを確認できません。'))
            .finally(() => setIsResolvingTeam(false));
        }}
        token={invitationToken}
      />
    );
  if (!session) return <LoginPage />;
  if (isResolvingTeam)
    return (
      <AppShell>
        <section className="app-state-card" aria-live="polite" role="status">
          チーム情報を確認しています。
        </section>
      </AppShell>
    );
  if (teamError)
    return (
      <AppShell>
        <section className="app-state-card" role="alert">
          {teamError}
        </section>
      </AppShell>
    );
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
      <SelectedTeamHeader
        isLoggingOut={isLoggingOut}
        onLogout={() => void logout()}
        team={selectedTeam}
      />
      <nav aria-label="ヘルプ">
        <a href="/manual">操作マニュアル</a>
      </nav>
      <MemberManagementPage
        api={memberApi}
        invitationApi={authInvitationApi}
        role={role}
      />
      {eventsError ? <p role="alert">{eventsError}</p> : null}
      {role ? (
        <EventsPage api={eventsApi} role={role} memberOptions={eventMembers} />
      ) : null}
      {role ? (
        <RideOperationsPanel
          api={rideApi}
          isManager={role === 'owner' || role === 'admin' || role === 'staff'}
          members={eventMembers.map((member) => ({
            id: member.id,
            label: member.name,
          }))}
        />
      ) : null}
      {role && role !== 'guardian' ? (
        <AttachmentUploader api={attachmentApi} />
      ) : null}
      <BoardContactPage
        api={boardContactApi}
        canManage={role === 'owner' || role === 'admin'}
      />
      {role ? (
        <BulletinBoardPage
          api={bulletinBoardApi}
          attachmentApi={attachmentApi}
          role={role}
        />
      ) : null}
      {role ? (
        <LineNotificationPanel api={lineNotificationApi} role={role} />
      ) : null}
      {role && role !== 'staff' ? (
        <OrdersPaymentsPage
          key={selectedTeamId}
          api={ordersApi}
          role={role}
          members={eventMembers}
        />
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
