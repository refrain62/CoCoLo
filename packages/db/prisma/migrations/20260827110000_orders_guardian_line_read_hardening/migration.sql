-- ORD-001: 無効化されたguardianの注文明細参照を明示的に拒否する。

DROP POLICY order_lines_read ON order_lines;
CREATE POLICY order_lines_read ON order_lines
  FOR SELECT USING (
    app_has_active_membership(tenant_id)
    AND EXISTS (
      SELECT 1
      FROM order_entries oe
      WHERE oe.tenant_id = order_lines.tenant_id
        AND oe.id = order_lines.order_entry_id
        AND (
          app_is_manager()
          OR (
            oe.orderer_user_id = current_setting('app.user_id', true)
            AND EXISTS (
              SELECT 1
              FROM guardian_members gm
              WHERE gm.tenant_id = oe.tenant_id
                AND gm.member_id = oe.member_id
                AND gm.user_id = current_setting('app.user_id', true)
                AND gm.status = 'active'::member_link_status
            )
          )
        )
    )
  );

COMMENT ON POLICY order_lines_read ON order_lines IS
  'active所属かつactive linkのguardian、またはmanagerだけが注文明細を読み取れる';
