import { describe, expect, it } from 'vitest';
import {
  adminNavigation,
  isAdminNavigationVisible,
  resolveAdminRoute,
} from './admin-routes.js';

describe('管理画面ルート', () => {
  it('パスを専用画面へ解決する', () => {
    expect(resolveAdminRoute('/admin')).toBe('dashboard');
    expect(resolveAdminRoute('/admin/members')).toBe('members');
    expect(resolveAdminRoute('/admin/features')).toBe('features');
    expect(resolveAdminRoute('/unknown')).toBe('dashboard');
  });

  it('roleとfeature契約に応じてメニューを表示する', () => {
    const orders = adminNavigation.find((item) => item.route === 'orders');
    const features = adminNavigation.find((item) => item.route === 'features');
    const paidFeatures = [{ key: 'orders-payments', enabled: true }];
    const freeFeatures = [{ key: 'orders-payments', enabled: false }];

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
  });
});
