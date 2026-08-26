import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../prisma/migrations/20260827110000_orders_guardian_line_read_hardening/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('共同購買の注文明細RLS hardening', () => {
  it('注文明細のguardian参照をactiveな担当linkへ限定する', () => {
    expect(migration).toContain('DROP POLICY order_lines_read ON order_lines;');
    expect(migration).toContain(
      'CREATE POLICY order_lines_read ON order_lines',
    );
    expect(migration).toMatch(
      /gm\.member_id\s*=\s*oe\.member_id[\s\S]*gm\.user_id\s*=\s*current_setting\('app\.user_id', true\)[\s\S]*gm\.status\s*=\s*'active'::member_link_status/,
    );
    expect(migration).toContain(
      'COMMENT ON POLICY order_lines_read ON order_lines',
    );
  });
});
