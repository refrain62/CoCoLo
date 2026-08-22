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

-- tenant context確定前の所属解決だけを、固定search_path・user_id完全一致のDB関数へ限定する。
CREATE OR REPLACE FUNCTION public.app_resolve_active_membership(p_user_id text)
RETURNS TABLE (tenant_id uuid, role role)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT tm.tenant_id, tm.role
  FROM public.tenant_memberships AS tm
  WHERE tm.user_id = p_user_id
    AND tm.status = 'active'::public.membership_status
  ORDER BY tm.created_at
$$;

REVOKE ALL ON FUNCTION public.app_resolve_active_membership(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_resolve_active_membership(text) TO cocolo_app;
COMMENT ON FUNCTION public.app_resolve_active_membership(text) IS 'tenant context設定前の所属解決専用。引数のuser_idとactive所属だけを返す';
