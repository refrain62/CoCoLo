DROP POLICY IF EXISTS tenant_memberships_select ON tenant_memberships;
CREATE POLICY tenant_memberships_select ON tenant_memberships
  FOR SELECT
  USING (
    user_id = current_setting('app.user_id', true)
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

DROP POLICY IF EXISTS audit_logs_insert ON audit_logs;
CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND actor_user_id = current_setting('app.user_id', true)
    AND current_setting('app.role', true) IN ('owner', 'admin', 'staff', 'guardian')
  );
