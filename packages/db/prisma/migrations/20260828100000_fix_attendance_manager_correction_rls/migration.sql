-- 管理者はguardianの既存回答を修正できる。guardian自身の回答者固定は維持する。

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

COMMENT ON POLICY attendance_update ON attendance_responses IS 'active managerは回答者を保持したまま修正でき、guardianは自分のactive linkだけ更新できる';
