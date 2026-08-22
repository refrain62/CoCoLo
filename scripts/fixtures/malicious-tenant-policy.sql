-- 悪性fixture: 実DBへ適用してはいけない。tenant tautologyとrole条件欠落を表す。
CREATE POLICY malicious_tenant_tautology ON members
  FOR SELECT USING (tenant_id = tenant_id);

CREATE POLICY malicious_missing_role ON members
  FOR UPDATE
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
