-- チーム単位の有償・無償機能契約を、画面表示ではなくAPIとworkerが共有する正本として管理する。

CREATE TYPE feature_billing_type AS ENUM ('free', 'paid');
CREATE TYPE tenant_plan_status AS ENUM ('active', 'trialing', 'past_due', 'canceled', 'expired');
CREATE TYPE feature_flag_source AS ENUM ('default', 'admin', 'operator', 'billing');

CREATE TABLE feature_definitions (
  key varchar(64) PRIMARY KEY,
  billing_type feature_billing_type NOT NULL,
  display_name varchar(200) NOT NULL,
  default_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (key ~ '^[a-z][a-z0-9._-]{1,63}$')
);

CREATE TABLE tenant_plans (
  id uuid PRIMARY KEY DEFAULT app_uuidv7(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
  plan_key varchar(100) NOT NULL,
  status tenant_plan_status NOT NULL,
  feature_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  billing_provider_subscription_id varchar(256),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (app_is_uuidv7(id)),
  CHECK (ends_at IS NULL OR starts_at < ends_at)
);

CREATE TABLE tenant_feature_flags (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  feature_key varchar(64) NOT NULL REFERENCES feature_definitions(key) ON DELETE RESTRICT,
  enabled boolean NOT NULL,
  source feature_flag_source NOT NULL,
  changed_by_user_id varchar(128) NOT NULL,
  reason varchar(500) NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, feature_key),
  CHECK (ends_at IS NULL OR starts_at < ends_at)
);
CREATE INDEX tenant_plans_tenant_status_starts_idx
  ON tenant_plans(tenant_id, status, starts_at);
CREATE INDEX tenant_feature_flags_tenant_period_idx
  ON tenant_feature_flags(tenant_id, starts_at, ends_at);

INSERT INTO feature_definitions (key, billing_type, display_name, default_enabled)
VALUES
  ('members', 'free', 'メンバー管理', true),
  ('events-attendance', 'free', '予定・出欠', true),
  ('bulletin-board', 'free', '回覧・添付', true),
  ('attachments', 'free', '添付ファイル', true),
  ('orders-payments', 'paid', '購買・集金', false),
  ('line-notifications', 'paid', 'LINE通知', false),
  ('ride-operations', 'paid', '送迎管理', false)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE feature_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_feature_flags FORCE ROW LEVEL SECURITY;

CREATE POLICY feature_definitions_read ON feature_definitions
  FOR SELECT
  USING (
    current_setting('app.role', true) = 'operator'
    OR app_has_active_membership(NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  );
CREATE POLICY tenant_plans_read ON tenant_plans
  FOR SELECT
  USING (
    (
      current_setting('app.role', true) = 'operator'
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
    OR app_has_active_membership(tenant_id)
  );
CREATE POLICY tenant_feature_flags_read ON tenant_feature_flags
  FOR SELECT
  USING (
    (
      current_setting('app.role', true) = 'operator'
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
    OR app_has_active_membership(tenant_id)
  );
CREATE POLICY tenant_plans_billing_insert ON tenant_plans
  FOR INSERT
  WITH CHECK (
    current_setting('app.role', true) = 'operator'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY tenant_plans_billing_update ON tenant_plans
  FOR UPDATE
  USING (
    current_setting('app.role', true) = 'operator'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.role', true) = 'operator'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY tenant_feature_flags_write ON tenant_feature_flags
  FOR INSERT
  WITH CHECK (
    app_has_active_membership(tenant_id)
    AND app_is_manager()
    AND source = 'admin'::feature_flag_source
    AND EXISTS (
      SELECT 1 FROM feature_definitions
       WHERE key = feature_key AND billing_type = 'free'::feature_billing_type
    )
    AND changed_by_user_id = current_setting('app.user_id', true)
  );
CREATE POLICY tenant_feature_flags_operator_insert ON tenant_feature_flags
  FOR INSERT
  WITH CHECK (
    current_setting('app.role', true) = 'operator'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND source IN ('operator'::feature_flag_source, 'billing'::feature_flag_source)
    AND EXISTS (
      SELECT 1 FROM feature_definitions
       WHERE key = feature_key AND billing_type = 'paid'::feature_billing_type
    )
    AND changed_by_user_id = current_setting('app.user_id', true)
  );
CREATE POLICY tenant_feature_flags_update ON tenant_feature_flags
  FOR UPDATE
  USING (
    app_has_active_membership(tenant_id)
    AND app_is_manager()
    AND EXISTS (
      SELECT 1 FROM feature_definitions
       WHERE key = feature_key AND billing_type = 'free'::feature_billing_type
    )
  )
  WITH CHECK (
    app_has_active_membership(tenant_id)
    AND app_is_manager()
    AND source = 'admin'::feature_flag_source
    AND changed_by_user_id = current_setting('app.user_id', true)
  );
CREATE POLICY tenant_feature_flags_operator_update ON tenant_feature_flags
  FOR UPDATE
  USING (
    current_setting('app.role', true) = 'operator'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM feature_definitions
       WHERE key = feature_key AND billing_type = 'paid'::feature_billing_type
    )
  )
  WITH CHECK (
    current_setting('app.role', true) = 'operator'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND source IN ('operator'::feature_flag_source, 'billing'::feature_flag_source)
    AND changed_by_user_id = current_setting('app.user_id', true)
  );

GRANT USAGE ON TYPE feature_billing_type, tenant_plan_status, feature_flag_source TO cocolo_app;
GRANT SELECT, INSERT, UPDATE ON tenant_plans TO cocolo_app;
GRANT SELECT ON feature_definitions TO cocolo_app;
GRANT SELECT, INSERT, UPDATE ON tenant_feature_flags TO cocolo_app;

COMMENT ON TABLE feature_definitions IS '課金区分と初期値を持つ機能定義の正本';
COMMENT ON TABLE tenant_plans IS 'チームの契約プランと有効期間。課金providerの識別子は外部連携用';
COMMENT ON TABLE tenant_feature_flags IS 'チーム単位の機能上書きと変更監査の入口';
COMMENT ON COLUMN tenant_plans.feature_keys IS 'このプランで利用を許可するfeature keyのスナップショット';
COMMENT ON COLUMN tenant_feature_flags.changed_by_user_id IS 'flag変更を実行したチーム利用者';
