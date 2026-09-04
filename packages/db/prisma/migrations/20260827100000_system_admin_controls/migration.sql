-- システム管理者専用の全体お知らせ・監査ログと、機能の全体停止フラグを追加する。

CREATE TYPE system_announcement_status AS ENUM ('draft', 'published', 'archived');

ALTER TABLE feature_definitions
  ADD COLUMN system_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE system_announcements (
  id uuid PRIMARY KEY DEFAULT app_uuidv7(),
  title varchar(200) NOT NULL,
  body text NOT NULL,
  status system_announcement_status NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  created_by_user_id varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (app_is_uuidv7(id)),
  CHECK (status <> 'published'::system_announcement_status OR published_at IS NOT NULL)
);

CREATE INDEX system_announcements_status_published_created_idx
  ON system_announcements(status, published_at, created_at);

CREATE TABLE system_audit_logs (
  id uuid PRIMARY KEY DEFAULT app_uuidv7(),
  actor_user_id varchar(128) NOT NULL,
  action varchar(100) NOT NULL,
  resource_type varchar(100) NOT NULL,
  resource_id uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (app_is_uuidv7(id)),
  CHECK (resource_id IS NULL OR app_is_uuidv7(resource_id))
);

CREATE INDEX system_audit_logs_created_idx
  ON system_audit_logs(created_at);

ALTER TABLE feature_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE system_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_announcements FORCE ROW LEVEL SECURITY;
ALTER TABLE system_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_audit_logs FORCE ROW LEVEL SECURITY;

-- system_admin はtenantを持たないため、既存のoperator/member policyとは別に定義する。
CREATE POLICY feature_definitions_system_admin_read ON feature_definitions
  FOR SELECT
  USING (current_setting('app.role', true) = 'system_admin');

CREATE POLICY feature_definitions_system_admin_update ON feature_definitions
  FOR UPDATE
  USING (current_setting('app.role', true) = 'system_admin')
  WITH CHECK (current_setting('app.role', true) = 'system_admin');

CREATE POLICY system_announcements_system_read ON system_announcements
  FOR SELECT
  USING (
    current_setting('app.role', true) = 'system_admin'
    OR (
      status = 'published'::system_announcement_status
      AND app_has_active_membership(NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    )
  );

CREATE POLICY system_announcements_system_insert ON system_announcements
  FOR INSERT
  WITH CHECK (
    current_setting('app.role', true) = 'system_admin'
    AND created_by_user_id = current_setting('app.user_id', true)
  );

CREATE POLICY system_announcements_system_update ON system_announcements
  FOR UPDATE
  USING (current_setting('app.role', true) = 'system_admin')
  WITH CHECK (current_setting('app.role', true) = 'system_admin');

CREATE POLICY system_audit_logs_system_admin_read ON system_audit_logs
  FOR SELECT
  USING (current_setting('app.role', true) = 'system_admin');

CREATE POLICY system_audit_logs_system_admin_insert ON system_audit_logs
  FOR INSERT
  WITH CHECK (
    current_setting('app.role', true) = 'system_admin'
    AND actor_user_id = current_setting('app.user_id', true)
  );

CREATE TRIGGER system_audit_logs_append_only_guard
BEFORE UPDATE OR DELETE ON system_audit_logs
FOR EACH ROW EXECUTE FUNCTION app_reject_audit_mutation();

REVOKE UPDATE, DELETE ON system_audit_logs FROM cocolo_app;
GRANT USAGE ON TYPE system_announcement_status TO cocolo_app;
GRANT SELECT, INSERT, UPDATE ON system_announcements TO cocolo_app;
GRANT SELECT, INSERT ON system_audit_logs TO cocolo_app;
GRANT UPDATE (system_enabled) ON feature_definitions TO cocolo_app;

COMMENT ON TABLE system_announcements IS 'system_adminが管理し、active tenant membershipにはpublishedだけを公開する全体お知らせ';
COMMENT ON TABLE system_audit_logs IS 'system_admin操作のtenant非依存・追記専用監査履歴';
COMMENT ON COLUMN feature_definitions.system_enabled IS 'system_adminによる全体停止フラグ。trueでもpaid featureのprovider/plan/付与要件は緩和しない';
