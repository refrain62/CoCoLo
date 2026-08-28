import type { TeamOption } from '@cocolo/contracts/auth-team-selection';
import { AppShell, Badge, Button, CoCoLoLogoMark } from '@cocolo/ui';
import type { ReactNode } from 'react';
import { handleInAppLinkClick } from './app-navigation.js';
import type { AuthRole } from './auth-context-api.js';
import { currentEnvironment } from './web-environment.js';

const roleLabels: Record<AuthRole, string> = {
  owner: 'オーナー',
  admin: '管理者',
  staff: 'スタッフ',
  guardian: '保護者',
};

export function UserShell({
  children,
  isLoggingOut = false,
  onLogout,
  role,
  team,
}: {
  children: ReactNode;
  isLoggingOut?: boolean;
  onLogout: () => void;
  role: AuthRole;
  team: TeamOption;
}) {
  return (
    <AppShell
      className="user-shell"
      brand={
        <>
          <CoCoLoLogoMark />
          <span>
            CoCoLo <small>Dashboard</small>
          </span>
        </>
      }
      sidebar={
        <>
          <a
            href="/dashboard"
            aria-current="page"
            onClick={(event) => handleInAppLinkClick(event, '/dashboard')}
          >
            <span className="admin-nav-dot" aria-hidden="true" />
            <span>
              <strong>ダッシュボード</strong>
              <small>予定と締め切りを確認</small>
            </span>
          </a>
          <a
            href="/team"
            onClick={(event) => handleInAppLinkClick(event, '/team')}
          >
            <span className="admin-nav-dot" aria-hidden="true" />
            <span>
              <strong>チーム管理</strong>
              <small>チームの情報を確認</small>
            </span>
          </a>
        </>
      }
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
      {children}
    </AppShell>
  );
}
