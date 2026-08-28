import type { TeamOption } from '@cocolo/contracts/auth-team-selection';
import { AppShell } from '@cocolo/ui';
import { useEffect, useMemo, useState } from 'react';
import { AdminDashboard } from './admin-dashboard.js';
import {
  type AdminRoute,
  isMemberOptionRoute,
  resolveAdminRoute,
} from './admin-routes.js';
import { AdminShell } from './admin-shell.js';

import { useAuth } from './auth-context.js';
import { type AuthRole, createAuthContextApi } from './auth-context-api.js';
import { createAttachmentApi } from './features/attachments/attachment-api.js';
import { AttachmentUploader } from './features/attachments/attachment-uploader.js';
import { createAuthInvitationApi } from './features/auth-invitations/auth-invitation-api.js';
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
import { createSystemAdminApi } from './system-admin-api.js';
import { SystemAdminPage } from './system-admin-page.js';
import { isSystemAdminPath } from './system-admin-routes.js';
import { SystemAdminShell } from './system-admin-shell.js';
import { createSystemContextApi } from './system-context-api.js';
import { TeamSettingsPage } from './team-settings-page.js';
import { UserDashboard } from './user-dashboard.js';
import { UserShell } from './user-shell.js';

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

export function AuthenticatedApp() {
  // 認証済みのsessionだけを受け取り、部員APIへ到達できる画面をsession保有者に限定する。
  const { authenticatedFetch, isLoggingOut, logout, session } = useAuth();
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const systemAdminPath = isSystemAdminPath(pathname);
  const [isSystemAdmin, setIsSystemAdmin] = useState<boolean | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<TeamOption | null>(null);
  const [isResolvingTeam, setIsResolvingTeam] = useState(true);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [role, setRole] = useState<AuthRole | null>(null);
  const [eventMembers, setEventMembers] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [memberOptionsError, setMemberOptionsError] = useState<string | null>(
    null,
  );
  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  const teamSelectionApi = useMemo(
    () =>
      createTeamSelectionApi({
        getAccessToken: () => session?.accessToken ?? null,
        fetcher: authenticatedFetch,
      }),
    [authenticatedFetch, session?.accessToken],
  );
  const systemContextApi = useMemo(
    () =>
      createSystemContextApi({
        getAccessToken: () => session?.accessToken ?? null,
        fetcher: authenticatedFetch,
      }),
    [authenticatedFetch, session?.accessToken],
  );
  const systemAdminApi = useMemo(
    () =>
      createSystemAdminApi({
        getAccessToken: () => session?.accessToken ?? null,
        fetcher: authenticatedFetch,
      }),
    [authenticatedFetch, session?.accessToken],
  );
  useEffect(() => {
    if (!systemAdminPath) {
      setIsSystemAdmin(null);
      return;
    }
    let active = true;
    setIsSystemAdmin(null);
    void systemContextApi
      .get()
      .then(() => {
        if (active) setIsSystemAdmin(true);
      })
      .catch(() => {
        if (active) setIsSystemAdmin(false);
      });
    return () => {
      active = false;
    };
  }, [systemAdminPath, systemContextApi]);
  useEffect(() => {
    if (systemAdminPath && isSystemAdmin === false) {
      window.history.replaceState({}, '', '/team');
      setPathname('/team');
    }
  }, [isSystemAdmin, systemAdminPath]);
  useEffect(() => {
    if (!systemAdminPath && (pathname === '/' || pathname === '/login')) {
      window.history.replaceState({}, '', '/dashboard');
      setPathname('/dashboard');
    }
  }, [pathname, systemAdminPath]);
  useEffect(() => {
    if (!session) {
      clearStoredSelectedTeamId();
      setSelectedTeam(null);
      setTeamError(null);
      setIsResolvingTeam(false);
      return;
    }
    if (systemAdminPath) {
      setIsResolvingTeam(false);
      setTeamError(null);
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
  }, [pathname, session, systemAdminPath, teamSelectionApi]);
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
  // 所属roleは全チーム画面の表示条件、部員候補は一部操作の入力データとして独立取得する。
  useEffect(() => {
    if (!session || !selectedTeam || systemAdminPath) {
      setRole(null);
      setRoleError(null);
      setEventMembers([]);
      setMemberOptionsError(null);
      return;
    }
    let active = true;
    setRole(null);
    setRoleError(null);
    setEventMembers([]);
    setMemberOptionsError(null);
    void authContextApi
      .get()
      .then((context) => {
        if (!active) return;
        setRole(context.role);
      })
      .catch(() => {
        if (active) setRoleError('チームの権限を確認できません。');
      });
    if (!isMemberOptionRoute(resolveAdminRoute(pathname)))
      return () => {
        active = false;
      };
    void memberApi
      .listAll({ q: '', category: '', status: 'active' })
      .then((members) => {
        if (!active) return;
        setEventMembers(
          members.map((member) => ({ id: member.id, name: member.name })),
        );
      })
      .catch(() => {
        if (active) {
          setMemberOptionsError(
            '対象メンバーを確認できないため、メンバーを選ぶ操作を利用できません。',
          );
        }
      });
    return () => {
      active = false;
    };
  }, [
    authContextApi,
    memberApi,
    pathname,
    selectedTeam,
    session,
    systemAdminPath,
  ]);
  if (!session) return null;
  if (systemAdminPath) {
    if (isSystemAdmin === null)
      return (
        <AppShell nav={null}>
          <section className="app-state-card" role="status">
            システム管理者権限を確認しています。
          </section>
        </AppShell>
      );
    if (!isSystemAdmin) return null;
    return (
      <SystemAdminShell
        isLoggingOut={isLoggingOut}
        onLogout={() => void logout()}
      >
        {(systemRoute) => (
          <SystemAdminPage
            api={systemAdminApi}
            onNavigate={navigateInApp}
            route={systemRoute}
          />
        )}
      </SystemAdminShell>
    );
  }
  if (isResolvingTeam)
    return (
      <AppShell nav={null}>
        <section className="app-state-card" aria-live="polite" role="status">
          チーム情報を確認しています。
        </section>
      </AppShell>
    );
  if (teamError)
    return (
      <AppShell nav={null}>
        <section className="app-state-card" role="alert">
          {teamError}
        </section>
      </AppShell>
    );
  if (!selectedTeam)
    return (
      <AppShell nav={null}>
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
      <AppShell nav={null}>
        <section
          className="app-state-card"
          role={roleError ? 'alert' : 'status'}
        >
          {roleError ?? 'チームの権限を確認しています。'}
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
    setRoleError(null);
    setEventMembers([]);
    setMemberOptionsError(null);
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
    const memberOptionsNotice =
      memberOptionsError && isMemberOptionRoute(route) ? (
        <p className="app-permission-note" role="alert">
          {memberOptionsError}
        </p>
      ) : null;
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
            onBack={() => navigateInApp('/team/events')}
          />
        );
      if (!isFeatureEnabled('events-attendance'))
        return (
          <DeepLinkState
            message="このチームでは予定機能を利用できません。"
            onBack={() => navigateInApp('/team')}
          />
        );
      return (
        <div className="admin-page-stack">
          {memberOptionsNotice}
          <EventsPage
            key={`notification-event-${notificationTarget.id}`}
            api={eventsApi}
            role={currentRole}
            memberOptions={eventMembers}
            selectionStorageKey={subjectMemberStorageKey}
            initialEventId={notificationTarget.id}
            onBack={() => navigateInApp('/team/events')}
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
            onBack={() => navigateInApp('/team/announcements')}
          />
        );
      if (!isFeatureEnabled('bulletin-board'))
        return (
          <DeepLinkState
            message="このチームでは回覧機能を利用できません。"
            onBack={() => navigateInApp('/team')}
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
            onBack={() => navigateInApp('/team/announcements')}
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
          <>
            {memberOptionsNotice}
            <EventsPage
              api={eventsApi}
              role={currentRole}
              memberOptions={eventMembers}
              selectionStorageKey={subjectMemberStorageKey}
            />
          </>
        ) : null}
        {route === 'orders' ? (
          <>
            {memberOptionsNotice}
            <OrdersPaymentsPage
              key={selectedTeamId}
              api={ordersApi}
              role={currentRole}
              members={eventMembers}
              selectionStorageKey={subjectMemberStorageKey}
            />
          </>
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
          <>
            {memberOptionsNotice}
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
          </>
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

  return pathname === '/dashboard' || pathname.startsWith('/dashboard/') ? (
    <UserShell
      isLoggingOut={isLoggingOut}
      onLogout={() => void logout()}
      role={currentRole}
      team={currentTeam}
    >
      <UserDashboard
        eventsApi={eventsApi}
        featureContractApi={featureContractApi}
        onNavigate={navigateInApp}
        ordersApi={ordersApi}
      />
    </UserShell>
  ) : (
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
