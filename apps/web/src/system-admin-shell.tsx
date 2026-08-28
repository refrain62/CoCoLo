import { AppShell, Badge, Button, CoCoLoLogoMark } from '@cocolo/ui';
import { type MouseEvent, type ReactNode, useEffect, useState } from 'react';
import { navigateInApp } from './app-navigation.js';
import { applyPageMetadata } from './app-route.js';
import {
  resolveSystemAdminRoute,
  type SystemAdminRoute,
  systemAdminNavigation,
} from './system-admin-routes.js';
import { currentEnvironment } from './web-environment.js';

export function SystemAdminShell({
  children,
  isLoggingOut = false,
  onLogout,
}: {
  children: (route: SystemAdminRoute) => ReactNode;
  isLoggingOut?: boolean;
  onLogout: () => void;
}) {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    applyPageMetadata(window.location.pathname);
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  function navigate(path: string) {
    if (path === window.location.pathname) return;
    navigateInApp(path);
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

  const activeRoute = resolveSystemAdminRoute(pathname);
  const navigation = systemAdminNavigation.map((item) => (
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
      className="admin-shell system-admin-shell"
      brand={
        <>
          <CoCoLoLogoMark />
          <span>
            CoCoLo <small>System Admin</small>
          </span>
        </>
      }
      sidebar={navigation}
      topbar={
        <>
          <div className="admin-topbar-context">
            <span className="admin-topbar-team">システム管理</span>
            <span className="admin-topbar-role">system admin</span>
          </div>
          <div className="admin-topbar-actions">
            <Badge variant="outline">{currentEnvironment()}</Badge>
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
      {children(activeRoute)}
    </AppShell>
  );
}
