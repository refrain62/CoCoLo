import { isLegacyTeamPath } from './admin-routes.js';

export type SystemAdminRoute = 'dashboard' | 'notices' | 'entitlements';

export type SystemAdminNavigationItem = {
  route: SystemAdminRoute;
  href: string;
  label: string;
  description: string;
};

export const systemAdminNavigation: readonly SystemAdminNavigationItem[] = [
  {
    route: 'dashboard',
    href: '/admin',
    label: 'システム概要',
    description: '全体設定の状況を確認',
  },
  {
    route: 'notices',
    href: '/admin/notices',
    label: '全体お知らせ',
    description: '利用者向けのお知らせを管理',
  },
  {
    route: 'entitlements',
    href: '/admin/entitlements',
    label: '有償機能',
    description: '有償機能の提供設定を確認',
  },
];

export function isSystemAdminPath(pathname: string) {
  return (
    pathname === '/admin' ||
    (pathname.startsWith('/admin/') && !isLegacyTeamPath(pathname))
  );
}

export function resolveSystemAdminRoute(pathname: string): SystemAdminRoute {
  return (
    systemAdminNavigation.find((item) => item.href === pathname)?.route ??
    'dashboard'
  );
}
