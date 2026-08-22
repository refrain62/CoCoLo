DROP POLICY IF EXISTS audit_logs_insert ON audit_logs;
CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND actor_user_id = current_setting('app.user_id', true)
    AND current_setting('app.role', true) IN ('owner', 'admin', 'staff', 'guardian')
  );
