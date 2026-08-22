-- 悪性fixture: 実DBへ適用してはいけない。tenant tautologyとrole条件欠落を表す。
CREATE POLICY malicious_tenant_tautology ON members
  FOR SELECT USING (tenant_id = tenant_id);

CREATE POLICY malicious_missing_role ON members
  FOR UPDATE
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY malicious_role_is_not_null ON members
  FOR SELECT
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND current_setting('app.role', true) IS NOT NULL);

CREATE POLICY malicious_missing_user_id ON guardian_members
  FOR SELECT
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY malicious_wrong_command ON members
  FOR UPDATE
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND current_setting('app.role', true) IN ('owner', 'admin'));

GRANT SELECT (id) ON members TO cocolo_app WITH GRANT OPTION;
