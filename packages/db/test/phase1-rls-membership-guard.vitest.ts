import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../prisma/migrations/20260828110000_phase1_rls_membership_guard/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Phase 1 RLSのmembership再検証', () => {
  it('core policyがDB上のactive membershipとroleを再確認する', () => {
    for (const policy of [
      'tenants_select',
      'tenant_memberships_select',
      'members_select',
      'members_write',
      'guardian_members_select',
      'audit_logs_owner_select',
      'audit_logs_insert',
      'promotion_runs_admin_write',
    ]) {
      expect(migration).toContain(`DROP POLICY IF EXISTS ${policy}`);
      expect(migration).toContain(`CREATE POLICY ${policy}`);
    }
    expect(migration).toContain(
      "app_is_active_member(id, current_setting('app.user_id', true))",
    );
    expect(migration).toMatch(
      /app_is_active_member_with_role\(\s*tenant_id,\s*current_setting\('app\.user_id', true\),\s*current_setting\('app\.role', true\)\s*\)/,
    );
    expect(migration).toContain("status = 'active'::member_link_status");
    expect(migration).toContain('app_has_active_membership(tenant_id)');
    expect(migration).toContain(
      "current_setting('app.role', true) = 'operator'",
    );
    expect(migration).toContain('COMMENT ON POLICY members_select ON members');
  });
});
