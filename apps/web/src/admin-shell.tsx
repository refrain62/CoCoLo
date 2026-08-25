import type { TeamOption } from '@cocolo/contracts/auth-team-selection';
import { AppShell, Badge, Button } from '@cocolo/ui';
import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  type AdminRoute,
  adminNavigation,
  isAdminNavigationVisible,
  resolveAdminRoute,
} from './admin-routes.js';
import type { AuthRole } from './auth-context-api.js';
import type {
  FeatureContractApi,
  FeatureContractSnapshot,
} from './features/feature-contract/feature-contract-api.js';

const roleLabels: Record<AuthRole, string> = {
  owner: 'オーナー',
  admin: '管理者',
  staff: 'スタッフ',
  guardian: '保護者',
};

const environmentLabels: Record<string, string> = {
  development: '開発',
  staging: '検証',
  production: '本番',
};

function currentEnvironment() {
  return environmentLabels[import.meta.env.MODE] ?? import.meta.env.MODE;
}

export function AdminShell({
  children,
  featureContractApi,
  isLoggingOut = false,
  onLogout,
  role,
  team,
}: {
  children: (
    route: AdminRoute,
    contract: FeatureContractSnapshot,
    onContractChange: (next: FeatureContractSnapshot) => void,
  ) => ReactNode;
  featureContractApi: FeatureContractApi;
  isLoggingOut?: boolean;
  onLogout: () => void;
  role: AuthRole;
  team: TeamOption;
}) {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [contract, setContract] = useState<FeatureContractSnapshot | null>(
    null,
  );
  const [contractError, setContractError] = useState<string | null>(null);

  useEffect(() => {
    if (window.location.pathname === '/') {
      window.history.replaceState({}, '', '/admin');
      setPathname('/admin');
    }
  }, []);

  useEffect(() => {
    let active = true;
    setContract(null);
    setContractError(null);
    void featureContractApi
      .get()
      .then((next) => {
        if (active) setContract(next);
      })
      .catch((error: unknown) => {
        if (active)
          setContractError(
            error instanceof Error
              ? error.message
              : '機能契約を確認できません。',
          );
      });
    return () => {
      active = false;
    };
  }, [featureContractApi]);

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const visibleNavigation = useMemo(() => {
    if (!contract)
      return adminNavigation.filter((item) => item.route === 'dashboard');
    const features = contract.features.map(({ key, enabled }) => ({
      key,
      enabled,
    }));
    return adminNavigation.filter((item) =>
      isAdminNavigationVisible(item, role, features),
    );
  }, [contract, role]);

  const requestedRoute = resolveAdminRoute(pathname);
  const activeItem = visibleNavigation.find(
    (item) => item.route === requestedRoute,
  );
  const activeRoute = activeItem?.route ?? 'dashboard';

  function navigate(path: string) {
    if (path === window.location.pathname) return;
    window.history.pushState({}, '', path);
    setPathname(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function navigateFromClick(
    event: MouseEvent<HTMLAnchorElement>,
    path: string,
  ) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    navigate(path);
  }

  const navigation = visibleNavigation.map((item) => (
    <a
      key={item.route}
      href={item.href}
      aria-current={item.route === activeRoute ? 'page' : undefined}
      onClick={(event) => navigateFromClick(event, item.href)}
    >
      <span className="admin-nav-dot" aria-hidden="true" />
      <span>
        <strong>{item.label}</strong>
        <small>{item.description}</small>
      </span>
    </a>
  ));

  return (
    <AppShell
      className="admin-shell"
      brand={
        <>
          <span className="app-brand-mark" aria-hidden="true">
            C
          </span>
          <span>
            CoCoLo <small>Admin</small>
          </span>
        </>
      }
      sidebar={navigation}
      topbar={
        <>
          <div className="admin-topbar-context">
            <span className="admin-topbar-team">{team.tenantName}</span>
            <span className="admin-topbar-role">{roleLabels[role]}</span>
          </div>
          <div className="admin-topbar-actions">
            <Badge variant="outline">{currentEnvironment()}</Badge>
            <a className="admin-help-link" href="/manual">
              ヘルプ
            </a>
            <Button
              size="sm"
              variant="ghost"
              disabled={isLoggingOut}
              onClick={onLogout}
            >
              {isLoggingOut ? 'ログアウト中…' : 'ログアウト'}
            </Button>
          </div>
        </>
      }
    >
      {contractError ? (
        <section className="admin-contract-error" role="alert">
          <strong>
            機能契約を確認できないため、操作メニューを制限しています。
          </strong>
          <span>{contractError}</span>
        </section>
      ) : null}
      {contract ? (
        children(activeRoute, contract, setContract)
      ) : contractError ? (
        <section className="admin-loading-state" role="status">
          利用可能な機能を確認できないため、業務画面を表示していません。
        </section>
      ) : (
        <section
          className="admin-loading-state"
          role="status"
          aria-live="polite"
        >
          チームの利用可能な機能を確認しています…
        </section>
      )}
    </AppShell>
  );
}
