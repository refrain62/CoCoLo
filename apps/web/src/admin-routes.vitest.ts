import { describe, expect, it } from 'vitest';
import {
  adminNavigation,
  canonicalAdminPath,
  isAdminNavigationVisible,
  isAdminRouteVisible,
  isMemberOptionRoute,
  normalizeRoutePath,
  resolveAdminRoute,
} from './admin-routes.js';

describe('管理画面ルート', () => {
  it('公開入口から認証済み利用者を管理画面へ正規化する', () => {
    expect(canonicalAdminPath('/')).toBe('/team');
    expect(canonicalAdminPath('/login')).toBe('/team');
    expect(canonicalAdminPath('/admin')).toBe('/admin');
    expect(canonicalAdminPath('/dashboard')).toBe('/team');
    expect(canonicalAdminPath('/admin/members')).toBe('/team/members');
    expect(canonicalAdminPath('/admin/events/detail')).toBe(
      '/team/events/detail',
    );
    expect(canonicalAdminPath('/admin/members/')).toBe('/team/members');
    expect(normalizeRoutePath('/team/events/')).toBe('/team/events');
  });

  it('パスを専用画面へ解決する', () => {
    expect(resolveAdminRoute('/admin')).toBe('dashboard');
    expect(resolveAdminRoute('/team')).toBe('dashboard');
    expect(resolveAdminRoute('/team/members')).toBe('members');
    expect(resolveAdminRoute('/team/members/')).toBe('members');
    expect(resolveAdminRoute('/admin/board-contacts')).toBe('board-contacts');
    expect(resolveAdminRoute('/admin/features')).toBe('features');
    expect(
      resolveAdminRoute('/events/0190f3b5-7c00-7000-8000-000000000001'),
    ).toBe('event-detail');
    expect(
      resolveAdminRoute('/bulletins/0190f3b5-7c00-7000-8000-000000000002'),
    ).toBe('bulletin-detail');
    expect(resolveAdminRoute('/events/not-a-uuid')).toBe('dashboard');
    expect(resolveAdminRoute('/unknown')).toBe('dashboard');
  });

  it('roleとfeature契約に応じてメニューを表示する', () => {
    const orders = adminNavigation.find((item) => item.route === 'orders');
    const features = adminNavigation.find((item) => item.route === 'features');
    const settings = adminNavigation.find((item) => item.route === 'settings');
    const boardContacts = adminNavigation.find(
      (item) => item.route === 'board-contacts',
    );
    const paidFeatures = [{ key: 'orders-payments', enabled: true }];
    const freeFeatures = [{ key: 'orders-payments', enabled: false }];
    const boardContactFeatures = [{ key: 'board-contacts', enabled: true }];

    expect(
      orders && isAdminNavigationVisible(orders, 'guardian', paidFeatures),
    ).toBe(true);
    expect(
      orders && isAdminNavigationVisible(orders, 'staff', paidFeatures),
    ).toBe(false);
    expect(
      orders && isAdminNavigationVisible(orders, 'admin', freeFeatures),
    ).toBe(false);
    expect(
      features && isAdminNavigationVisible(features, 'owner', paidFeatures),
    ).toBe(true);
    expect(
      features && isAdminNavigationVisible(features, 'staff', paidFeatures),
    ).toBe(false);
    expect(
      settings &&
        isAdminNavigationVisible(settings, 'owner', boardContactFeatures),
    ).toBe(true);
    expect(
      settings && isAdminNavigationVisible(settings, 'owner', freeFeatures),
    ).toBe(false);
    expect(
      boardContacts &&
        isAdminNavigationVisible(boardContacts, 'staff', boardContactFeatures),
    ).toBe(true);
    expect(
      boardContacts &&
        isAdminNavigationVisible(
          boardContacts,
          'guardian',
          boardContactFeatures,
        ),
    ).toBe(true);
    expect(
      boardContacts &&
        isAdminNavigationVisible(boardContacts, 'staff', freeFeatures),
    ).toBe(false);
    expect(
      boardContacts &&
        isAdminNavigationVisible(boardContacts, 'admin', boardContactFeatures),
    ).toBe(true);
  });

  it('送迎は管理者と保護者に表示する', () => {
    const features = [{ key: 'ride-operations', enabled: true }];
    expect(isAdminRouteVisible('ride', 'owner', features)).toBe(true);
    expect(isAdminRouteVisible('ride', 'guardian', features)).toBe(true);
  });

  it('部員候補を必要とする画面だけを判定する', () => {
    expect(isMemberOptionRoute('events')).toBe(true);
    expect(isMemberOptionRoute('event-detail')).toBe(true);
    expect(isMemberOptionRoute('orders')).toBe(true);
    expect(isMemberOptionRoute('ride')).toBe(true);
    expect(isMemberOptionRoute('members')).toBe(false);
    expect(isMemberOptionRoute('announcements')).toBe(false);
  });
});
