import type { MemberRole } from '@cocolo/contracts/member';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { AuthSession } from './auth-client.js';
import {
  type AttachmentApi,
  createAttachmentApi,
} from './features/attachments/attachment-api.js';
import { AttachmentUploader } from './features/attachments/attachment-uploader.js';
import {
  BoardContactPage,
  createBoardContactApi,
} from './features/board-contact/index.js';
import {
  BulletinBoardPage,
  createBulletinBoardApi,
} from './features/bulletin-board/index.js';
import {
  createEventsApi,
  type EventsApi,
} from './features/events/events-api.js';
import { EventsPage } from './features/events/events-page.js';
import { LineNotificationPanel } from './features/line-notifications/line-notification-panel.js';
import {
  createLineNotificationApi,
  type LineNotificationApi,
} from './features/line-notifications/line-notifications-api.js';
import {
  createOrdersPaymentsApi,
  type OrdersPaymentsApi,
} from './features/orders-payments/index.js';
import { OrdersPaymentsPage } from './features/orders-payments/orders-payments-page.js';
import {
  createRideOperationsApi,
  type RideOperationsApi,
} from './features/ride-operations/ride-operations-api.js';
import { RideOperationsPanel } from './features/ride-operations/ride-operations-panel.js';
import { createMemberApi, type MemberApi } from './member-api.js';
import { MemberManagementPage } from './member-management-page.js';
import { UserManualPage } from './user-manual-page.js';

export type CentralResourceFeature =
  | 'events'
  | 'orders'
  | 'attachments'
  | 'bulletins';

export type CentralRoute =
  | { kind: 'home' }
  | { kind: 'manual' }
  | { kind: 'members' }
  | { kind: 'events' }
  | { kind: 'board-contacts' }
  | { kind: 'orders' }
  | { kind: 'attachments' }
  | { kind: 'line' }
  | { kind: 'ride-missing' }
  | { kind: 'ride'; planId: string }
  | { kind: 'bulletins' }
  | {
      kind: 'resource-unavailable';
      feature: CentralResourceFeature;
      resourceId: string;
    }
  | {
      kind: 'invalid-resource';
      feature: CentralResourceFeature | 'ride';
    }
  | { kind: 'unknown'; pathname: string };

export type CentralIdentityState =
  | { status: 'loading' }
  | { status: 'unavailable'; message: string }
  | { status: 'ready'; tenantId: string; role: MemberRole };

type CentralIdentityResponse = {
  data?: {
    tenantId?: unknown;
    role?: unknown;
  };
};

export class CentralIdentityApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CentralIdentityApiError';
  }
}

export type CentralIdentityApi = {
  getCurrent: () => Promise<{ tenantId: string; role: MemberRole }>;
};

const uuidV7Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const roles = new Set<MemberRole>(['owner', 'admin', 'staff', 'guardian']);

const roleLabels: Record<MemberRole, string> = {
  owner: 'オーナー',
  admin: '管理者',
  staff: 'スタッフ',
  guardian: '保護者',
};

const managerRoles = new Set<MemberRole>(['owner', 'admin']);
const rideManagerRoles = new Set<MemberRole>(['owner', 'admin', 'staff']);

function normalizePathname(pathname: string) {
  const path = pathname.split(/[?#]/, 1)[0] ?? '/';
  if (path === '/') return path;
  return path.replace(/\/+$/, '') || '/';
}

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function resourceRoute(
  feature: CentralResourceFeature | 'ride',
  rawResourceId: string | undefined,
): CentralRoute {
  const resourceId = rawResourceId ? decodeSegment(rawResourceId) : null;
  if (!resourceId || !isUuidV7(resourceId))
    return { kind: 'invalid-resource', feature };
  if (feature === 'ride') return { kind: 'ride', planId: resourceId };
  return { kind: 'resource-unavailable', feature, resourceId };
}

// URLの資源IDをUUIDv7の境界で止め、連番や任意文字列をAPIへ渡さない。
export function isUuidV7(value: string) {
  return uuidV7Pattern.test(value);
}

// 画面URLを固定したfeature routeへ変換し、未実装の詳細画面は未接続状態として扱う。
export function matchCentralRoute(pathname: string): CentralRoute {
  const normalized = normalizePathname(pathname);
  const segments = normalized.split('/').filter(Boolean);
  const [resource, id, extra] = segments;

  if (segments.length === 0) return { kind: 'home' };
  if (extra) return { kind: 'unknown', pathname: normalized };

  if (resource === 'manual' && !id) return { kind: 'manual' };
  if (resource === 'members' && !id) return { kind: 'members' };
  if (resource === 'events' && !id) return { kind: 'events' };
  if (resource === 'board-contacts' && !id) return { kind: 'board-contacts' };
  if (resource === 'orders' && !id) return { kind: 'orders' };
  if (resource === 'attachments' && !id) return { kind: 'attachments' };
  if (resource === 'line' && !id) return { kind: 'line' };
  if (resource === 'ride' && !id) return { kind: 'ride-missing' };
  if (resource === 'bulletins' && !id) return { kind: 'bulletins' };

  if (resource === 'events' && id) return resourceRoute('events', id);
  if (resource === 'orders' && id) return resourceRoute('orders', id);
  if (resource === 'attachments' && id) return resourceRoute('attachments', id);
  if (resource === 'bulletins' && id) return resourceRoute('bulletins', id);
  if (resource === 'ride' && id) return resourceRoute('ride', id);

  return { kind: 'unknown', pathname: normalized };
}

// 認証前の直接URLを機能画面へ進ませず、認証済みの場合だけroute解決を許可する。
export function resolveCentralAuthState(
  pathname: string,
  session: AuthSession | null,
) {
  return session
    ? { status: 'authenticated' as const, route: matchCentralRoute(pathname) }
    : { status: 'unauthenticated' as const };
}

function responseMessage(status: number) {
  if (status === 401)
    return 'ログイン状態を確認できません。もう一度ログインしてください。';
  if (status === 403) return '利用可能な所属がありません。';
  if (status === 404 || status === 503)
    return '所属情報の中央APIが未接続です。機能APIの統合後に利用できます。';
  return '所属情報を取得できません。';
}

function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === 'string' && roles.has(value as MemberRole);
}

function readIdentityResponse(body: CentralIdentityResponse) {
  const tenantId = body.data?.tenantId;
  const role = body.data?.role;
  if (
    typeof tenantId !== 'string' ||
    !isUuidV7(tenantId) ||
    !isMemberRole(role)
  )
    throw new CentralIdentityApiError(502, '所属情報の応答形式が不正です。');
  return { tenantId, role };
}

// tenantはbodyやURLから受け取らず、Bearer tokenに紐づく中央APIの所属情報だけを利用する。
export function createCentralIdentityApi({
  getAccessToken,
  baseUrl = '',
  fetcher = fetch,
}: {
  getAccessToken: () => string | null;
  baseUrl?: string;
  fetcher?: typeof fetch;
}): CentralIdentityApi {
  return {
    async getCurrent() {
      const token = getAccessToken();
      if (!token)
        throw new CentralIdentityApiError(401, 'ログインが必要です。');
      const response = await fetcher(
        `${baseUrl.replace(/\/$/, '')}/api/v1/session`,
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (!response.ok)
        throw new CentralIdentityApiError(
          response.status,
          responseMessage(response.status),
        );
      return readIdentityResponse(
        (await response.json()) as CentralIdentityResponse,
      );
    },
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '通信に失敗しました。';
}

function useCentralIdentity(
  session: AuthSession | null,
  api: CentralIdentityApi,
  override: CentralIdentityState | undefined,
) {
  const [state, setState] = useState<CentralIdentityState>({
    status: 'loading',
  });

  useEffect(() => {
    if (!session || override) return;
    let active = true;
    setState({ status: 'loading' });
    void api
      .getCurrent()
      .then((identity) => {
        if (active) setState({ status: 'ready', ...identity });
      })
      .catch((error) => {
        if (active)
          setState({ status: 'unavailable', message: errorMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [api, override, session]);

  if (!session)
    return { status: 'unavailable' as const, message: 'ログインが必要です。' };
  return override ?? state;
}

type CentralApis = {
  member: MemberApi;
  events: EventsApi;
  boardContacts: ReturnType<typeof createBoardContactApi>;
  orders: OrdersPaymentsApi;
  attachments: AttachmentApi;
  line: LineNotificationApi;
  ride: RideOperationsApi;
  bulletinBoard: ReturnType<typeof createBulletinBoardApi>;
};

function createCentralApis(accessToken: string | null): CentralApis {
  const getAccessToken = () => accessToken;
  return {
    member: createMemberApi({ getAccessToken }),
    events: createEventsApi({ getAccessToken }),
    boardContacts: createBoardContactApi({ getAccessToken }),
    orders: createOrdersPaymentsApi({ getAccessToken }),
    attachments: createAttachmentApi({ getAccessToken }),
    line: createLineNotificationApi({ getAccessToken }),
    ride: createRideOperationsApi({ getAccessToken }),
    bulletinBoard: createBulletinBoardApi({ getAccessToken }),
  };
}

type MemberOption = { id: string; name: string };

function useMemberOptions(
  shouldLoad: boolean,
  identity: CentralIdentityState,
  api: MemberApi,
) {
  const [state, setState] = useState<
    | { status: 'idle' | 'loading' }
    | { status: 'ready'; options: MemberOption[] }
    | { status: 'error'; message: string }
  >({ status: 'idle' });

  useEffect(() => {
    if (!shouldLoad || identity.status !== 'ready') return;
    let active = true;
    setState({ status: 'loading' });
    void api
      .list({ q: '', category: '', status: '' })
      .then((members) => {
        if (active)
          setState({
            status: 'ready',
            options: members.map(({ id, name }) => ({ id, name })),
          });
      })
      .catch((error) => {
        if (active) setState({ status: 'error', message: errorMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [api, identity.status, shouldLoad]);

  return state;
}

function CentralNavigationLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: (href: string) => void;
}) {
  const links = [
    ['/members', '部員管理'],
    ['/events', '予定と出欠'],
    ['/board-contacts', '役員と連絡先'],
    ['/orders', '共同購買と集金'],
    ['/attachments', '添付'],
    ['/line', 'LINE通知'],
    ['/ride', '送迎'],
    ['/bulletins', '回覧板'],
    ['/manual', '操作マニュアル'],
  ] as const;

  return (
    <nav aria-label="機能" className="central-navigation">
      <a
        href="/"
        aria-current={pathname === '/' ? 'page' : undefined}
        onClick={(event) => {
          event.preventDefault();
          onNavigate('/');
        }}
      >
        トップ
      </a>
      {links.map(([href, label]) => (
        <a
          key={href}
          href={href}
          aria-current={pathname === href ? 'page' : undefined}
          onClick={(event) => {
            event.preventDefault();
            onNavigate(href);
          }}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

function IntegrationNotice({ children }: { children: ReactNode }) {
  return (
    <div className="central-feature-frame">
      <p className="central-integration-notice" role="note">
        画面モジュールを表示しています。feature
        APIの中央mountが完了するまで、データ操作は利用できません。
      </p>
      {children}
    </div>
  );
}

function AccessDenied({ message }: { message: string }) {
  return (
    <p className="central-state" role="alert">
      {message}
    </p>
  );
}

function MemberOptionsState({
  state,
}: {
  state:
    | { status: 'idle' | 'loading' }
    | { status: 'ready'; options: MemberOption[] }
    | { status: 'error'; message: string };
}) {
  if (state.status === 'loading' || state.status === 'idle')
    return (
      <p className="central-state" role="status">
        担当部員を読み込み中…
      </p>
    );
  if (state.status !== 'error') return null;
  return (
    <p className="central-state" role="alert">
      担当部員を取得できないため、この画面の操作を表示できません。
      {state.message}
    </p>
  );
}

function UnavailableResource({
  feature,
  resourceId,
}: {
  feature: CentralResourceFeature;
  resourceId: string;
}) {
  const labels: Record<CentralResourceFeature, string> = {
    events: '予定',
    orders: '共同購買',
    attachments: '添付',
    bulletins: '回覧板',
  };
  return (
    <p className="central-state" role="alert">
      {labels[feature]}詳細画面（資源ID: {resourceId}
      ）は、中央APIと詳細画面の統合後に利用できます。
    </p>
  );
}

function renderCentralRoute(
  route: CentralRoute,
  identity: Extract<CentralIdentityState, { status: 'ready' }>,
  apis: CentralApis,
  memberOptions: MemberOption[],
) {
  const { role } = identity;
  switch (route.kind) {
    case 'home':
      return (
        <section aria-labelledby="central-home-heading">
          <h1 id="central-home-heading">CoCoLo</h1>
          <p>機能を選択してください。</p>
        </section>
      );
    case 'manual':
      return <UserManualPage />;
    case 'members':
      return managerRoles.has(role) ? (
        <IntegrationNotice>
          <MemberManagementPage api={apis.member} />
        </IntegrationNotice>
      ) : (
        <AccessDenied message="部員管理画面はオーナーまたは管理者だけが利用できます。" />
      );
    case 'events':
      return (
        <IntegrationNotice>
          <EventsPage
            api={apis.events}
            memberOptions={memberOptions.map(({ id, name }) => ({ id, name }))}
            role={role}
          />
        </IntegrationNotice>
      );
    case 'board-contacts':
      return managerRoles.has(role) ? (
        <IntegrationNotice>
          <BoardContactPage api={apis.boardContacts} />
        </IntegrationNotice>
      ) : (
        <AccessDenied message="役員と連絡先の編集画面はオーナーまたは管理者だけが利用できます。" />
      );
    case 'orders':
      return (
        <IntegrationNotice>
          <OrdersPaymentsPage
            api={apis.orders}
            members={memberOptions.map(({ id, name }) => ({ id, name }))}
            role={role}
          />
        </IntegrationNotice>
      );
    case 'attachments':
      return (
        <IntegrationNotice>
          <AttachmentUploader api={apis.attachments} />
        </IntegrationNotice>
      );
    case 'line':
      return (
        <IntegrationNotice>
          <LineNotificationPanel api={apis.line} role={role} />
        </IntegrationNotice>
      );
    case 'ride':
      return (
        <IntegrationNotice>
          <RideOperationsPanel
            api={apis.ride}
            isManager={rideManagerRoles.has(role)}
            members={memberOptions.map(({ id, name }) => ({ id, label: name }))}
            planId={route.planId}
          />
        </IntegrationNotice>
      );
    case 'ride-missing':
      return (
        <AccessDenied message="送迎予定のUUIDv7をURLに指定してください。" />
      );
    case 'bulletins':
      return (
        <IntegrationNotice>
          <BulletinBoardPage api={apis.bulletinBoard} role={role} />
        </IntegrationNotice>
      );
    case 'resource-unavailable':
      return (
        <UnavailableResource
          feature={route.feature}
          resourceId={route.resourceId}
        />
      );
    case 'invalid-resource':
      return (
        <AccessDenied message="URLの資源IDがUUIDv7ではありません。資源を表示していません。" />
      );
    case 'unknown':
      return <AccessDenied message={`このURLの画面は存在しません。`} />;
  }
}

export function CentralNavigation({
  session,
  identityState,
  identityApi,
  memberApi,
}: {
  session: AuthSession | null;
  identityState?: CentralIdentityState;
  identityApi?: CentralIdentityApi;
  memberApi?: MemberApi;
}) {
  const [pathname, setPathname] = useState(() =>
    typeof window === 'undefined' ? '/' : window.location.pathname,
  );
  const getAccessToken = useCallback(
    () => session?.accessToken ?? null,
    [session?.accessToken],
  );
  const resolvedIdentityApi = useMemo(
    () => identityApi ?? createCentralIdentityApi({ getAccessToken }),
    [getAccessToken, identityApi],
  );
  const identity = useCentralIdentity(
    session,
    resolvedIdentityApi,
    identityState,
  );
  const apis = useMemo(
    () =>
      memberApi
        ? {
            ...createCentralApis(session?.accessToken ?? null),
            member: memberApi,
          }
        : createCentralApis(session?.accessToken ?? null),
    [memberApi, session?.accessToken],
  );
  const route = useMemo(() => matchCentralRoute(pathname), [pathname]);
  const needsMemberOptions =
    route.kind === 'events' ||
    route.kind === 'ride' ||
    (route.kind === 'orders' &&
      identity.status === 'ready' &&
      identity.role === 'guardian');
  const memberOptionsState = useMemberOptions(
    needsMemberOptions,
    identity,
    apis.member,
  );

  useEffect(() => {
    function onPopState() {
      setPathname(window.location.pathname);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function navigate(href: string) {
    window.history.pushState({}, '', href);
    setPathname(href);
  }

  const authState = resolveCentralAuthState(pathname, session);
  if (authState.status === 'unauthenticated')
    return (
      <section className="central-state" aria-labelledby="central-auth-heading">
        <h1 id="central-auth-heading">ログインが必要です</h1>
        <p>認証が完了するまで機能画面を表示しません。</p>
      </section>
    );

  return (
    <>
      <CentralNavigationLinks pathname={pathname} onNavigate={navigate} />
      {identity.status === 'loading' ? (
        <p className="central-state" role="status">
          所属情報を確認中…
        </p>
      ) : identity.status === 'unavailable' ? (
        <p className="central-state" role="alert">
          {identity.message}
        </p>
      ) : (
        <>
          <p className="central-identity" role="status">
            現在の権限: {roleLabels[identity.role]}
          </p>
          {needsMemberOptions && memberOptionsState.status !== 'ready' ? (
            <MemberOptionsState state={memberOptionsState} />
          ) : (
            renderCentralRoute(
              route,
              identity,
              apis,
              memberOptionsState.status === 'ready'
                ? memberOptionsState.options
                : [],
            )
          )}
        </>
      )}
    </>
  );
}
