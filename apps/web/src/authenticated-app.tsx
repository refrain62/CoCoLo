import type { TeamOption } from '@cocolo/contracts/auth-team-selection';
import { AppShell } from '@cocolo/ui';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { AdminDashboard } from './admin-dashboard.js';
import type { AdminRoute } from './admin-routes.js';
import { AdminShell } from './admin-shell.js';

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
import {
  createFeatureContractApi,
  type FeatureContractSnapshot,
} from './features/feature-contract/feature-contract-api.js';
import { FeatureContractPanel } from './features/feature-contract/feature-contract-panel.js';
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
import {
  isNotificationDeepLink,
  parseNotificationDeepLink,
} from './notification-deep-link.js';
import { TeamSettingsPage } from './team-settings-page.js';

function navigateInApp(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function DeepLinkState({
  message,
  onBack,
}: {
  message: string;
  onBack?: () => void;
}) {
  return (
    <section className="app-state-card" role="alert">
      <h1>通知のリンクを開けません</h1>
      <p>{message}</p>
      {onBack ? (
        <button type="button" onClick={onBack}>
          管理画面へ戻る
        </button>
      ) : null}
    </section>
  );
}

export function AuthenticatedApp({ publicRoot }: { publicRoot?: ReactNode }) {
  // 認証状態が確定するまでLoginPageを表示し、部員APIへ到達できる画面をsession保有者に限定する。
  const { authenticatedFetch, isLoggingOut, logout, session } = useAuth();
  const [pathname, setPathname] = useState(() => window.location.pathname);
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
        const mustChooseTeam =
          isNotificationDeepLink(pathname) && teams.length > 1;
        const nextTeam = mustChooseTeam
          ? null
          : (storedTeam ?? (teams.length === 1 ? teams[0] : null));
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
  }, [pathname, session, teamSelectionApi]);
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
  const featureContractApi = useMemo(
    () =>
      createFeatureContractApi({
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
  if (isInvitationPath(pathname))
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
  if (!session) return publicRoot ?? <LoginPage />;
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

  if (!role)
    return (
      <AppShell>
        <section
          className="app-state-card"
          role={eventsError ? 'alert' : 'status'}
        >
          {eventsError ?? 'チームの権限を確認しています。'}
        </section>
      </AppShell>
    );

  const currentRole = role;
  const currentTeam = selectedTeam;
  const subjectMemberStorageKey = `cocolo.selectedSubjectMemberId.${selectedTeamId}`;

  function requestTeamSelection() {
    clearStoredSelectedTeamId();
    setSelectedTeam(null);
    setRole(null);
    setEventsError(null);
  }

  function renderAdminPage(
    route: AdminRoute,
    contract: FeatureContractSnapshot,
    onContractChange: (next: FeatureContractSnapshot) => void,
  ) {
    const isFeatureEnabled = (key: string) =>
      contract.features.some(
        (feature) => feature.key === key && feature.enabled,
      );
    const notificationTarget = parseNotificationDeepLink(pathname);
    const intro = {
      members: [
        'Members',
        'メンバー',
        '部員と所属、招待されたメンバーの状態を管理します。',
      ],
      events: [
        'Schedule',
        '予定・出欠',
        '開催予定を確認し、対象メンバーの出欠を管理します。',
      ],
      orders: [
        'Purchasing',
        '購買・集金',
        'メンバーごとの注文と集金状態を確認します。',
      ],
      announcements: [
        'Bulletin',
        '回覧・添付',
        'チームへのお知らせと添付ファイルを管理します。',
      ],
      line: ['LINE', 'LINE通知', 'LINEの接続状態と通知操作を管理します。'],
      ride: ['Transport', '送迎管理', '乗車希望と配車の状況を管理します。'],
      settings: [
        'Team settings',
        'チーム設定',
        'チーム運営に必要な役員連絡先と設定を管理します。',
      ],
      'board-contacts': [
        'Board contacts',
        '役員・連絡先',
        '年度の役職と、権限に応じて公開された連絡先を確認します。',
      ],
    } as const;
    if (route === 'dashboard')
      return (
        <AdminDashboard
          contract={contract}
          onNavigate={(path) => {
            window.history.pushState({}, '', path);
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          role={currentRole}
          team={currentTeam}
        />
      );
    if (route === 'features')
      return (
        <FeatureContractPanel
          api={featureContractApi}
          onSnapshotChange={onContractChange}
          role={currentRole}
        />
      );

    if (route === 'event-detail') {
      if (notificationTarget?.kind !== 'event')
        return (
          <DeepLinkState
            message="対象の予定リンクを確認できません。"
            onBack={() => navigateInApp('/admin/events')}
          />
        );
      if (!isFeatureEnabled('events-attendance'))
        return (
          <DeepLinkState
            message="このチームでは予定機能を利用できません。"
            onBack={() => navigateInApp('/admin')}
          />
        );
      return (
        <div className="admin-page-stack">
          <EventsPage
            key={`notification-event-${notificationTarget.id}`}
            api={eventsApi}
            role={currentRole}
            memberOptions={eventMembers}
            selectionStorageKey={subjectMemberStorageKey}
            initialEventId={notificationTarget.id}
            onBack={() => navigateInApp('/admin/events')}
            onAccessDenied={requestTeamSelection}
          />
        </div>
      );
    }

    if (route === 'bulletin-detail') {
      if (notificationTarget?.kind !== 'bulletin')
        return (
          <DeepLinkState
            message="対象の回覧リンクを確認できません。"
            onBack={() => navigateInApp('/admin/announcements')}
          />
        );
      if (!isFeatureEnabled('bulletin-board'))
        return (
          <DeepLinkState
            message="このチームでは回覧機能を利用できません。"
            onBack={() => navigateInApp('/admin')}
          />
        );
      return (
        <div className="admin-page-stack">
          <BulletinBoardPage
            key={`notification-bulletin-${notificationTarget.id}`}
            api={bulletinBoardApi}
            attachmentApi={attachmentApi}
            attachmentsEnabled={isFeatureEnabled('attachments')}
            role={currentRole}
            initialAnnouncementId={notificationTarget.id}
            onBack={() => navigateInApp('/admin/announcements')}
            onAccessDenied={requestTeamSelection}
          />
        </div>
      );
    }

    const [eyebrow, title, description] = intro[route];
    return (
      <div className="admin-page-stack">
        <header className="admin-route-header">
          <p className="admin-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </header>
        {route === 'members' ? (
          <MemberManagementPage api={memberApi} role={currentRole} />
        ) : null}
        {route === 'events' ? (
          <EventsPage
            api={eventsApi}
            role={currentRole}
            memberOptions={eventMembers}
            selectionStorageKey={subjectMemberStorageKey}
          />
        ) : null}
        {route === 'orders' ? (
          <OrdersPaymentsPage
            key={selectedTeamId}
            api={ordersApi}
            role={currentRole}
            members={eventMembers}
            selectionStorageKey={subjectMemberStorageKey}
          />
        ) : null}
        {route === 'announcements' ? (
          <>
            {currentRole !== 'guardian' && isFeatureEnabled('attachments') ? (
              <AttachmentUploader api={attachmentApi} />
            ) : null}
            <BulletinBoardPage
              api={bulletinBoardApi}
              attachmentApi={attachmentApi}
              attachmentsEnabled={isFeatureEnabled('attachments')}
              role={currentRole}
            />
          </>
        ) : null}
        {route === 'line' ? (
          <LineNotificationPanel api={lineNotificationApi} role={currentRole} />
        ) : null}
        {route === 'ride' ? (
          <RideOperationsPanel
            api={rideApi}
            isManager={
              currentRole === 'owner' ||
              currentRole === 'admin' ||
              currentRole === 'staff'
            }
            members={eventMembers.map((member) => ({
              id: member.id,
              label: member.name,
            }))}
            selectionStorageKey={subjectMemberStorageKey}
          />
        ) : null}
        {route === 'settings' ? (
          <TeamSettingsPage
            onNavigate={(path) => navigateInApp(path)}
            role={currentRole}
            team={currentTeam}
          />
        ) : null}
        {route === 'board-contacts' ? (
          <BoardContactPage
            api={boardContactApi}
            canManage={currentRole === 'owner' || currentRole === 'admin'}
          />
        ) : null}
      </div>
    );
  }

  return (
    <AdminShell
      featureContractApi={featureContractApi}
      isLoggingOut={isLoggingOut}
      onLogout={() => void logout()}
      role={currentRole}
      team={currentTeam}
    >
      {(route, contract, onContractChange) =>
        route === 'members' ? (
          <div className="admin-page-stack">
            <header className="admin-route-header">
              <p className="admin-eyebrow">Members</p>
              <h1>メンバー</h1>
              <p>部員と所属、招待されたメンバーの状態を管理します。</p>
            </header>
            <MemberManagementPage
              api={memberApi}
              invitationApi={authInvitationApi}
              role={currentRole}
            />
          </div>
        ) : (
          renderAdminPage(route, contract, onContractChange)
        )
      }
    </AdminShell>
  );
}

export function AuthenticatedRuntime({
  publicRoot,
}: {
  publicRoot?: ReactNode;
}) {
  return (
    <AuthProvider>
      <AuthenticatedApp publicRoot={publicRoot} />
    </AuthProvider>
  );
}
