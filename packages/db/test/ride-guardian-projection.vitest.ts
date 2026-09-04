import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../prisma/migrations/20260826100000_ride_guardian_projection/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const triggerHardeningMigration = readFileSync(
  new URL(
    '../prisma/migrations/20260827120000_ride_profile_trigger_record_guard/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('送迎の確定配車projection migration', () => {
  it('運転者名を送迎テーブルへ複製せず、所属プロフィールから投影する', () => {
    expect(migration).not.toContain(
      'ADD COLUMN IF NOT EXISTS driver_display_name',
    );
    expect(migration).not.toContain('o.driver_display_name');
    expect(migration).toContain('JOIN tenant_memberships tm');
    expect(migration).toContain('tm.display_name');
    expect(migration).toContain('app_ride_confirmed_assignments');
    expect(migration).toContain('ride_member_published_name_guard');
    expect(migration).toContain('ride_membership_published_name_guard');
    expect(migration).toContain('ride.display_name.update');
    expect(migration).toContain('jsonb_build_array');
  });

  it('異なる行型のtriggerでOLDの未存在列を参照しない', () => {
    expect(triggerHardeningMigration).toContain(
      "IF TG_TABLE_NAME = 'members' THEN",
    );
    expect(triggerHardeningMigration).toContain(
      "ELSIF TG_TABLE_NAME = 'tenant_memberships' THEN",
    );
    expect(triggerHardeningMigration).toContain('OLD.name');
    expect(triggerHardeningMigration).toContain('OLD.display_name');
    expect(triggerHardeningMigration).toContain('app_lock_ride_driver_plans');
    expect(triggerHardeningMigration).toContain('target_plan_id uuid');
    expect(triggerHardeningMigration).toContain(
      'SELECT target_tenant_id, target_plan_id',
    );
    expect(triggerHardeningMigration).toContain('pg_advisory_xact_lock');
    expect(triggerHardeningMigration).toContain(
      'ORDER BY rr.tenant_id, rr.plan_id',
    );
    expect(triggerHardeningMigration).toContain(
      'ORDER BY ro.tenant_id, ro.plan_id',
    );
    expect(triggerHardeningMigration).not.toContain('to_jsonb(OLD)');
    expect(triggerHardeningMigration).not.toContain('to_jsonb(NEW)');
  });
});
