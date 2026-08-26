import type { AuthRole } from './auth-context-api.js';
import { parseNotificationDeepLink } from './notification-deep-link.js';

export type AdminRoute =
  | 'dashboard'
  | 'members'
  | 'events'
  | 'orders'
  | 'announcements'
  | 'line'
  | 'ride'
  | 'settings'
  | 'board-contacts'
  | 'features'
  | 'event-detail'
  | 'bulletin-detail';

export type AdminFeature = {
  key: string;
  enabled: boolean;
};

export type AdminNavigationItem = {
  route: AdminRoute;
  href: string;
  label: string;
  description: string;
  featureKey?: string;
  roles?: AuthRole[];
};

const legacyAdminPaths: Readonly<Record<string, AdminRoute>> = {
  '/members': 'members',
  '/events': 'events',
  '/orders': 'orders',
  '/announcements': 'announcements',
  '/line': 'line',
  '/ride': 'ride',
  '/settings': 'settings',
  '/features': 'features',
};

export const adminNavigation: readonly AdminNavigationItem[] = [
  {
    route: 'dashboard',
    href: '/admin',
    label: 'ダッシュボード',
    description: 'チームの状況を確認',
  },
  {
    route: 'members',
    href: '/admin/members',
    label: 'メンバー',
    description: '部員と所属を管理',
    featureKey: 'members',
  },
  {
    route: 'events',
    href: '/admin/events',
    label: '予定・出欠',
    description: '予定と回答を管理',
    featureKey: 'events-attendance',
  },
  {
    route: 'orders',
    href: '/admin/orders',
    label: '購買・集金',
    description: '注文と支払いを管理',
    featureKey: 'orders-payments',
    roles: ['owner', 'admin', 'guardian'],
  },
  {
    route: 'announcements',
    href: '/admin/announcements',
    label: '回覧・添付',
    description: 'お知らせとファイルを共有',
    featureKey: 'bulletin-board',
  },
  {
    route: 'line',
    href: '/admin/line',
    label: 'LINE通知',
    description: '接続と通知を管理',
    featureKey: 'line-notifications',
    roles: ['owner', 'admin', 'staff'],
  },
  {
    route: 'ride',
    href: '/admin/ride',
    label: '送迎管理',
    description: '乗車希望と配車を管理',
    featureKey: 'ride-operations',
    roles: ['owner', 'admin', 'staff', 'guardian'],
  },
  {
    route: 'settings',
    href: '/admin/settings',
    label: 'チーム設定',
    description: '役員連絡先と運用設定',
    featureKey: 'board-contacts',
    roles: ['owner', 'admin'],
  },
  {
    route: 'board-contacts',
    href: '/admin/board-contacts',
    label: '役員・連絡先',
    description: '年度の役職と連絡先を確認',
    featureKey: 'board-contacts',
  },
  {
    route: 'features',
    href: '/admin/features',
    label: '機能契約',
    description: 'プランと機能flagを確認',
    roles: ['owner', 'admin'],
  },
];

export function resolveAdminRoute(pathname: string): AdminRoute {
  const deepLink = parseNotificationDeepLink(pathname);
  if (deepLink?.kind === 'event') return 'event-detail';
  if (deepLink?.kind === 'bulletin') return 'bulletin-detail';
  const item = adminNavigation.find((candidate) => candidate.href === pathname);
  return item?.route ?? legacyAdminPaths[pathname] ?? 'dashboard';
}

export function canonicalAdminPath(pathname: string) {
  if (pathname === '/' || pathname === '/login') return '/admin';
  const route = legacyAdminPaths[pathname];
  return route
    ? (adminNavigation.find((item) => item.route === route)?.href ?? pathname)
    : pathname;
}

export function isAdminRouteVisible(
  route: AdminRoute,
  role: AuthRole,
  features: readonly AdminFeature[],
) {
  const item = adminNavigation.find((candidate) => candidate.route === route);
  return item ? isAdminNavigationVisible(item, role, features) : false;
}

export function isAdminNavigationVisible(
  item: AdminNavigationItem,
  role: AuthRole,
  features: readonly AdminFeature[],
) {
  if (item.roles && !item.roles.includes(role)) return false;
  if (!item.featureKey) return true;
  return features.some(
    (feature) => feature.key === item.featureKey && feature.enabled,
  );
}
