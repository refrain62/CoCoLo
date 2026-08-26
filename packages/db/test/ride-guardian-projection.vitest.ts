import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../prisma/migrations/20260826100000_ride_guardian_projection/migration.sql',
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
});
