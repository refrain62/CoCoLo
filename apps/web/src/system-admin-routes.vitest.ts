import { describe, expect, it } from 'vitest';
import {
  isSystemAdminPath,
  resolveSystemAdminRoute,
} from './system-admin-routes.js';

describe('システム管理ルート', () => {
  it('system admin専用の入口だけをadmin配下で解決する', () => {
    expect(isSystemAdminPath('/admin')).toBe(true);
    expect(isSystemAdminPath('/admin/notices')).toBe(true);
    expect(isSystemAdminPath('/admin/entitlements')).toBe(true);
    expect(isSystemAdminPath('/admin/members')).toBe(false);
    expect(isSystemAdminPath('/admin/events/detail')).toBe(false);
    expect(resolveSystemAdminRoute('/admin/notices')).toBe('notices');
  });
});
