CREATE TYPE role AS ENUM ('owner', 'admin', 'staff', 'guardian');
CREATE TYPE membership_status AS ENUM ('invited', 'active', 'suspended');
CREATE TYPE member_category AS ENUM ('student', 'adult');
CREATE TYPE member_status AS ENUM ('active', 'retired', 'suspended');
CREATE TYPE promotion_run_status AS ENUM ('preview', 'completed', 'failed');

CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  name varchar(200) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tenant_memberships (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id varchar(128) NOT NULL,
  role role NOT NULL,
  status membership_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE TABLE members (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name varchar(200) NOT NULL,
  kana varchar(200),
  category member_category NOT NULL,
  grade_level integer,
  age_group varchar(100),
  status member_status NOT NULL DEFAULT 'active',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (grade_level IS NULL OR grade_level BETWEEN 1 AND 99),
  CHECK ((category = 'student' AND age_group IS NULL) OR (category = 'adult' AND grade_level IS NULL))
);
CREATE TABLE guardian_members (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id varchar(128) NOT NULL,
  member_id uuid NOT NULL,
  relationship varchar(100) NOT NULL,
  consented_at timestamptz,
  UNIQUE (tenant_id, user_id, member_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, member_id) REFERENCES members(tenant_id, id) ON DELETE RESTRICT
);
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  actor_user_id varchar(128) NOT NULL,
  action varchar(100) NOT NULL,
  resource_type varchar(100) NOT NULL,
  resource_id uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE promotion_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  fiscal_year integer NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 2100),
  status promotion_run_status NOT NULL,
  preview_count integer NOT NULL DEFAULT 0,
  executed_at timestamptz,
  actor_user_id varchar(128) NOT NULL,
  idempotency_key varchar(128),
  request_hash char(64),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, fiscal_year),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX tenant_memberships_user_status_idx ON tenant_memberships(user_id, status);
CREATE INDEX members_tenant_status_category_idx ON members(tenant_id, status, category);
CREATE INDEX members_tenant_name_idx ON members(tenant_id, name);
CREATE INDEX guardian_members_tenant_user_idx ON guardian_members(tenant_id, user_id);
CREATE INDEX audit_logs_tenant_created_idx ON audit_logs(tenant_id, created_at);
CREATE INDEX promotion_runs_tenant_status_idx ON promotion_runs(tenant_id, status);

COMMENT ON TABLE tenants IS 'チームのテナント境界';
COMMENT ON TABLE tenant_memberships IS 'Supabase利用者とチームの所属・役割';
COMMENT ON TABLE members IS 'チームに所属する部員';
COMMENT ON TABLE guardian_members IS '保護者と部員のチーム内関係';
COMMENT ON TABLE audit_logs IS '個人情報操作を含む追記専用監査履歴';
COMMENT ON TABLE promotion_runs IS '年度繰り上げの冪等実行履歴';
COMMENT ON COLUMN members.tenant_id IS '所属チームID';
COMMENT ON COLUMN members.grade_level IS 'studentの内部学年値';
COMMENT ON COLUMN members.note IS '管理者専用の特記事項';
COMMENT ON COLUMN guardian_members.tenant_id IS '所属チームID';
COMMENT ON COLUMN promotion_runs.idempotency_key IS '同一年度実行の冪等キー';

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE members FORCE ROW LEVEL SECURITY;
ALTER TABLE guardian_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian_members FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE promotion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_select ON tenants FOR SELECT USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_memberships_select ON tenant_memberships FOR SELECT USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND user_id = current_setting('app.user_id', true));
CREATE POLICY members_select ON members FOR SELECT USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY members_write ON members FOR ALL USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND current_setting('app.role', true) IN ('owner', 'admin')) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND current_setting('app.role', true) IN ('owner', 'admin'));
CREATE POLICY guardian_members_select ON guardian_members FOR SELECT USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND user_id = current_setting('app.user_id', true));
CREATE POLICY audit_logs_owner_select ON audit_logs FOR SELECT USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND current_setting('app.role', true) = 'owner');
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND actor_user_id = current_setting('app.user_id', true));
CREATE POLICY promotion_runs_admin_write ON promotion_runs FOR ALL USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND current_setting('app.role', true) IN ('owner', 'admin')) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND current_setting('app.role', true) IN ('owner', 'admin'));

GRANT USAGE ON TYPE role, membership_status, member_category, member_status, promotion_run_status TO cocolo_app;
GRANT SELECT, INSERT, UPDATE ON tenants, tenant_memberships, members, guardian_members, audit_logs, promotion_runs TO cocolo_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cocolo_app;
