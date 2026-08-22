-- 任意のuser_idを受けるSECURITY DEFINERを撤去し、所属検索もtenant_membershipsのRLSへ戻す。
DROP FUNCTION IF EXISTS public.app_resolve_active_membership(text);

DROP POLICY IF EXISTS tenant_memberships_select ON tenant_memberships;
CREATE POLICY tenant_memberships_select ON tenant_memberships
  FOR SELECT
  USING (
    user_id = current_setting('app.user_id', true)
    AND (
      NULLIF(current_setting('app.tenant_id', true), '') IS NULL
      OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  );
