-- revoked / suspended linkが既存のguardian認可へ残らないよう、RLSの担当条件をactiveへ固定する。

DROP POLICY guardian_members_select ON guardian_members;
CREATE POLICY guardian_members_select ON guardian_members
  FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = current_setting('app.user_id', true)
    AND status = 'active'::member_link_status
  );

DROP POLICY attendance_select ON attendance_responses;
CREATE POLICY attendance_select ON attendance_responses
  FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_active_member(tenant_id, current_setting('app.user_id', true))
    AND app_is_live_member(tenant_id, member_id)
    AND (
      (
        app_is_active_member_with_role(tenant_id, current_setting('app.user_id', true), current_setting('app.role', true))
        AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
      )
      OR (
        current_setting('app.role', true) = 'guardian'
        AND app_is_active_member_with_role(tenant_id, current_setting('app.user_id', true), 'guardian')
        AND user_id = current_setting('app.user_id', true)
        AND EXISTS (
          SELECT 1 FROM guardian_members
          WHERE guardian_members.tenant_id = attendance_responses.tenant_id
            AND guardian_members.user_id = current_setting('app.user_id', true)
            AND guardian_members.member_id = attendance_responses.member_id
            AND guardian_members.status = 'active'::member_link_status
        )
      )
    )
  );

DROP POLICY attendance_insert ON attendance_responses;
CREATE POLICY attendance_insert ON attendance_responses
  FOR INSERT
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_active_member(tenant_id, current_setting('app.user_id', true))
    AND app_is_live_member(tenant_id, member_id)
    AND user_id = current_setting('app.user_id', true)
    AND (
      (
        app_is_active_member_with_role(tenant_id, current_setting('app.user_id', true), current_setting('app.role', true))
        AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
      )
      OR (
        current_setting('app.role', true) = 'guardian'
        AND app_is_active_member_with_role(tenant_id, current_setting('app.user_id', true), 'guardian')
        AND EXISTS (
          SELECT 1 FROM guardian_members
          WHERE guardian_members.tenant_id = attendance_responses.tenant_id
            AND guardian_members.user_id = current_setting('app.user_id', true)
            AND guardian_members.member_id = attendance_responses.member_id
            AND guardian_members.status = 'active'::member_link_status
        )
      )
    )
  );

DROP POLICY attendance_update ON attendance_responses;
CREATE POLICY attendance_update ON attendance_responses
  FOR UPDATE
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_active_member(tenant_id, current_setting('app.user_id', true))
    AND app_is_live_member(tenant_id, member_id)
    AND (
      (
        app_is_active_member_with_role(tenant_id, current_setting('app.user_id', true), current_setting('app.role', true))
        AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
      )
      OR (
        current_setting('app.role', true) = 'guardian'
        AND app_is_active_member_with_role(tenant_id, current_setting('app.user_id', true), 'guardian')
        AND user_id = current_setting('app.user_id', true)
        AND EXISTS (
          SELECT 1 FROM guardian_members
          WHERE guardian_members.tenant_id = attendance_responses.tenant_id
            AND guardian_members.user_id = current_setting('app.user_id', true)
            AND guardian_members.member_id = attendance_responses.member_id
            AND guardian_members.status = 'active'::member_link_status
        )
      )
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_active_member(tenant_id, current_setting('app.user_id', true))
    AND app_is_live_member(tenant_id, member_id)
    AND user_id = current_setting('app.user_id', true)
    AND (
      (
        app_is_active_member_with_role(tenant_id, current_setting('app.user_id', true), current_setting('app.role', true))
        AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
      )
      OR (
        current_setting('app.role', true) = 'guardian'
        AND app_is_active_member_with_role(tenant_id, current_setting('app.user_id', true), 'guardian')
        AND EXISTS (
          SELECT 1 FROM guardian_members
          WHERE guardian_members.tenant_id = attendance_responses.tenant_id
            AND guardian_members.user_id = current_setting('app.user_id', true)
            AND guardian_members.member_id = attendance_responses.member_id
            AND guardian_members.status = 'active'::member_link_status
        )
      )
    )
  );

DROP POLICY order_entries_read ON order_entries;
CREATE POLICY order_entries_read ON order_entries
  FOR SELECT USING (
    app_has_active_membership(tenant_id)
    AND (
      app_is_manager()
      OR (
        orderer_user_id = current_setting('app.user_id', true)
        AND EXISTS (
          SELECT 1 FROM guardian_members gm
          WHERE gm.tenant_id = order_entries.tenant_id
            AND gm.member_id = order_entries.member_id
            AND gm.user_id = current_setting('app.user_id', true)
            AND gm.status = 'active'::member_link_status
        )
      )
    )
  );

DROP POLICY order_entries_insert ON order_entries;
CREATE POLICY order_entries_insert ON order_entries
  FOR INSERT WITH CHECK (
    app_has_active_membership(tenant_id)
    AND current_setting('app.role', true) = 'guardian'
    AND orderer_user_id = current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1 FROM guardian_members gm
      WHERE gm.tenant_id = order_entries.tenant_id
        AND gm.member_id = order_entries.member_id
        AND gm.user_id = current_setting('app.user_id', true)
        AND gm.status = 'active'::member_link_status
    )
  );

DROP POLICY order_lines_insert ON order_lines;
CREATE POLICY order_lines_insert ON order_lines
  FOR INSERT WITH CHECK (
    app_has_active_membership(tenant_id)
    AND current_setting('app.role', true) = 'guardian'
    AND EXISTS (
      SELECT 1 FROM order_entries oe
      WHERE oe.tenant_id = order_lines.tenant_id
        AND oe.id = order_lines.order_entry_id
        AND oe.orderer_user_id = current_setting('app.user_id', true)
        AND EXISTS (
          SELECT 1 FROM guardian_members gm
          WHERE gm.tenant_id = oe.tenant_id
            AND gm.member_id = oe.member_id
            AND gm.user_id = current_setting('app.user_id', true)
            AND gm.status = 'active'::member_link_status
        )
    )
  );

DROP POLICY ride_requests_read ON ride_requests;
CREATE POLICY ride_requests_read ON ride_requests
  FOR SELECT USING (
    app_has_active_membership(tenant_id)
    AND (
      app_is_event_manager()
      OR requester_user_id = current_setting('app.user_id', true)
      OR EXISTS (
        SELECT 1 FROM guardian_members gm
        WHERE gm.tenant_id = ride_requests.tenant_id
          AND gm.member_id = ride_requests.member_id
          AND gm.user_id = current_setting('app.user_id', true)
          AND gm.status = 'active'::member_link_status
      )
    )
  );

DROP POLICY ride_requests_insert ON ride_requests;
CREATE POLICY ride_requests_insert ON ride_requests
  FOR INSERT WITH CHECK (
    app_has_active_membership(tenant_id)
    AND requester_user_id = current_setting('app.user_id', true)
    AND (
      app_is_event_manager()
      OR (
        current_setting('app.role', true) = 'guardian'
        AND EXISTS (
          SELECT 1 FROM guardian_members gm
          WHERE gm.tenant_id = ride_requests.tenant_id
            AND gm.member_id = ride_requests.member_id
            AND gm.user_id = current_setting('app.user_id', true)
            AND gm.status = 'active'::member_link_status
        )
      )
    )
  );

COMMENT ON POLICY guardian_members_select ON guardian_members IS 'activeな担当member linkだけを読み取れる';
COMMENT ON POLICY attendance_select ON attendance_responses IS 'active所属かつactive linkのmanagerまたはguardianだけ出欠を読み取れる';
COMMENT ON POLICY order_entries_read ON order_entries IS 'active所属かつactive linkのguardianだけ対象memberの注文を読み取れる';
COMMENT ON POLICY ride_requests_read ON ride_requests IS 'active所属かつactive linkのguardianだけ対象memberの送迎希望を読み取れる';
