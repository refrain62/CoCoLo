-- Phase 1のcore RLSはtransaction-local contextだけでなく、DB上の所属状態とroleを再検証する。

DROP POLICY IF EXISTS tenants_select ON tenants;
CREATE POLICY tenants_select ON tenants
  FOR SELECT
  USING (
    id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_active_member(id, current_setting('app.user_id', true))
  );

DROP POLICY IF EXISTS tenant_memberships_select ON tenant_memberships;
CREATE POLICY tenant_memberships_select ON tenant_memberships
  FOR SELECT
  USING (
    user_id = current_setting('app.user_id', true)
    AND (
      NULLIF(current_setting('app.tenant_id', true), '') IS NULL
      OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
    AND (
      status = 'invited'::membership_status
      OR app_is_active_member(tenant_id, current_setting('app.user_id', true))
    )
  );

DROP POLICY IF EXISTS members_select ON members;
CREATE POLICY members_select ON members
  FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_active_member(tenant_id, current_setting('app.user_id', true))
    AND (
      (
        current_setting('app.role', true) IN ('owner', 'admin', 'staff')
        AND app_is_active_member_with_role(
          tenant_id,
          current_setting('app.user_id', true),
          current_setting('app.role', true)
        )
      )
      OR (
        current_setting('app.role', true) = 'guardian'
        AND app_is_active_member_with_role(
          tenant_id,
          current_setting('app.user_id', true),
          'guardian'
        )
        AND EXISTS (
          SELECT 1
          FROM guardian_members
          WHERE guardian_members.tenant_id = members.tenant_id
            AND guardian_members.member_id = members.id
            AND guardian_members.user_id = current_setting('app.user_id', true)
            AND guardian_members.status = 'active'::member_link_status
        )
      )
    )
  );

DROP POLICY IF EXISTS members_write ON members;
CREATE POLICY members_write ON members
  FOR ALL
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND current_setting('app.role', true) IN ('owner', 'admin')
    AND app_is_active_member_with_role(
      tenant_id,
      current_setting('app.user_id', true),
      current_setting('app.role', true)
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND current_setting('app.role', true) IN ('owner', 'admin')
    AND app_is_active_member_with_role(
      tenant_id,
      current_setting('app.user_id', true),
      current_setting('app.role', true)
    )
  );

DROP POLICY IF EXISTS guardian_members_select ON guardian_members;
CREATE POLICY guardian_members_select ON guardian_members
  FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = current_setting('app.user_id', true)
    AND status = 'active'::member_link_status
    AND app_is_active_member_with_role(
      tenant_id,
      current_setting('app.user_id', true),
      'guardian'
    )
  );

DROP POLICY IF EXISTS audit_logs_owner_select ON audit_logs;
CREATE POLICY audit_logs_owner_select ON audit_logs
  FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_active_member_with_role(
      tenant_id,
      current_setting('app.user_id', true),
      'owner'
    )
    AND current_setting('app.role', true) = 'owner'
  );

DROP POLICY IF EXISTS audit_logs_insert ON audit_logs;
CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND (
      (
        app_has_active_membership(tenant_id)
        AND app_is_active_member(tenant_id, current_setting('app.user_id', true))
        AND actor_user_id = current_setting('app.user_id', true)
      )
      OR (
        current_setting('app.role', true) = 'operator'
        AND actor_user_id = current_setting('app.user_id', true)
      )
    )
  );

DROP POLICY IF EXISTS promotion_runs_admin_write ON promotion_runs;
CREATE POLICY promotion_runs_admin_write ON promotion_runs
  FOR ALL
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND current_setting('app.role', true) IN ('owner', 'admin')
    AND app_is_active_member_with_role(
      tenant_id,
      current_setting('app.user_id', true),
      current_setting('app.role', true)
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND current_setting('app.role', true) IN ('owner', 'admin')
    AND app_is_active_member_with_role(
      tenant_id,
      current_setting('app.user_id', true),
      current_setting('app.role', true)
    )
  );

COMMENT ON POLICY members_select ON members IS 'active membershipとDB上のrole、およびguardianのactive担当linkを再検証して部員参照を許可する';
