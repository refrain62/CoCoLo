import { isLegacyTeamPath, normalizeRoutePath } from './admin-routes.js';

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
  const normalizedPath = normalizeRoutePath(pathname);
  return (
    normalizedPath === '/admin' ||
    (normalizedPath.startsWith('/admin/') && !isLegacyTeamPath(normalizedPath))
  );
}

export function resolveSystemAdminRoute(pathname: string): SystemAdminRoute {
  const normalizedPath = normalizeRoutePath(pathname);
  return (
    systemAdminNavigation.find((item) => item.href === normalizedPath)?.route ??
    'dashboard'
  );
}
