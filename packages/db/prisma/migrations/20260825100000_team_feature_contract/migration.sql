-- チーム単位の有償・無償機能契約を、画面表示ではなくAPIとworkerが共有する正本として管理する。

CREATE TYPE feature_billing_type AS ENUM ('free', 'paid');
CREATE TYPE tenant_plan_status AS ENUM ('active', 'trialing', 'past_due', 'canceled', 'expired');
CREATE TYPE feature_flag_source AS ENUM ('default', 'admin', 'operator', 'billing');
CREATE TYPE feature_contract_event_operation AS ENUM ('plan_sync', 'paid_grant');
CREATE TYPE feature_grant_approval_status AS ENUM ('approved', 'consumed', 'revoked');

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
  provider_version integer NOT NULL DEFAULT 0,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (app_is_uuidv7(id)),
  CHECK (ends_at IS NULL OR starts_at < ends_at)
);

CREATE TABLE feature_plan_definitions (
  plan_key varchar(100) PRIMARY KEY,
  feature_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 課金providerの外部アカウントとtenantの紐付けは、アプリでは作成・変更しない。
CREATE TABLE tenant_billing_accounts (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  provider_account_id varchar(128) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_account_id)
);

-- 手動付与は、課金状態と運用者の承認を先に記録した一回限りの台帳だけを消費する。
CREATE TABLE feature_grant_approvals (
  id uuid PRIMARY KEY DEFAULT app_uuidv7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  provider_account_id varchar(128) NOT NULL,
  feature_key varchar(64) NOT NULL REFERENCES feature_definitions(key) ON DELETE RESTRICT,
  approval_token_hash char(64) NOT NULL,
  billing_status tenant_plan_status NOT NULL,
  billing_provider_subscription_id varchar(256) NOT NULL,
  approved_by_user_id varchar(128) NOT NULL,
  approved_at timestamptz NOT NULL,
  starts_at timestamptz NOT NULL,
  expires_at timestamptz,
  ends_at timestamptz,
  status feature_grant_approval_status NOT NULL DEFAULT 'approved',
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (app_is_uuidv7(id)),
  CHECK (billing_status IN ('active'::tenant_plan_status, 'trialing'::tenant_plan_status)),
  CHECK (starts_at < COALESCE(ends_at, 'infinity'::timestamptz)),
  CHECK (expires_at IS NULL OR approved_at < expires_at),
  CHECK (ends_at IS NULL OR starts_at < ends_at),
  CHECK (status <> 'consumed'::feature_grant_approval_status OR consumed_at IS NOT NULL),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, provider_account_id)
    REFERENCES tenant_billing_accounts(tenant_id, provider_account_id)
    ON DELETE RESTRICT
);

CREATE TABLE feature_contract_events (
  id uuid PRIMARY KEY DEFAULT app_uuidv7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  event_id varchar(128) NOT NULL,
  operation feature_contract_event_operation NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  payload_hash char(64) NOT NULL,
  approval_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (app_is_uuidv7(id)),
  UNIQUE (tenant_id, event_id),
  FOREIGN KEY (tenant_id, approval_id)
    REFERENCES feature_grant_approvals(tenant_id, id)
    ON DELETE RESTRICT
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
  provider_version integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, feature_key),
  CHECK (ends_at IS NULL OR starts_at < ends_at)
);
CREATE INDEX tenant_plans_tenant_status_starts_idx
  ON tenant_plans(tenant_id, status, starts_at);
CREATE INDEX tenant_feature_flags_tenant_period_idx
  ON tenant_feature_flags(tenant_id, starts_at, ends_at);
CREATE INDEX feature_contract_events_tenant_operation_version_idx
  ON feature_contract_events(tenant_id, operation, version);
CREATE INDEX feature_grant_approvals_tenant_provider_status_idx
  ON feature_grant_approvals(tenant_id, provider_account_id, status);
CREATE INDEX feature_grant_approvals_tenant_feature_status_idx
  ON feature_grant_approvals(tenant_id, feature_key, status);
CREATE INDEX feature_contract_events_tenant_approval_idx
  ON feature_contract_events(tenant_id, approval_id);

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

INSERT INTO feature_plan_definitions (plan_key, feature_keys)
VALUES
  ('free', ARRAY['members', 'events-attendance', 'bulletin-board', 'attachments']),
  ('standard', ARRAY['members', 'events-attendance', 'bulletin-board', 'attachments', 'orders-payments']),
  ('premium', ARRAY['members', 'events-attendance', 'bulletin-board', 'attachments', 'orders-payments', 'line-notifications', 'ride-operations'])
ON CONFLICT (plan_key) DO NOTHING;

ALTER TABLE feature_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_feature_flags FORCE ROW LEVEL SECURITY;
ALTER TABLE feature_plan_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_plan_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_billing_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE feature_grant_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_grant_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE feature_contract_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_contract_events FORCE ROW LEVEL SECURITY;

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
CREATE POLICY feature_plan_definitions_operator_read ON feature_plan_definitions
  FOR SELECT
  USING (current_setting('app.role', true) = 'operator');
CREATE POLICY tenant_billing_accounts_operator_read ON tenant_billing_accounts
  FOR SELECT
  USING (
    current_setting('app.role', true) = 'operator'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY feature_grant_approvals_operator_read ON feature_grant_approvals
  FOR SELECT
  USING (
    current_setting('app.role', true) = 'operator'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY feature_grant_approvals_operator_consume ON feature_grant_approvals
  FOR UPDATE
  USING (
    current_setting('app.role', true) = 'operator'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND status = 'approved'::feature_grant_approval_status
  )
  WITH CHECK (
    current_setting('app.role', true) = 'operator'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND status = 'consumed'::feature_grant_approval_status
    AND consumed_at IS NOT NULL
  );
CREATE POLICY feature_contract_events_operator_read ON feature_contract_events
  FOR SELECT
  USING (
    current_setting('app.role', true) = 'operator'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY feature_contract_events_operator_insert ON feature_contract_events
  FOR INSERT
  WITH CHECK (
    current_setting('app.role', true) = 'operator'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
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

-- 課金連携はmembershipを持たないoperatorとして監査するため、通常利用者のRLSと分離する。
DROP POLICY IF EXISTS audit_logs_insert ON audit_logs;
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT
  WITH CHECK (
    (
      app_has_active_membership(tenant_id)
      AND actor_user_id = current_setting('app.user_id', true)
    )
    OR (
      current_setting('app.role', true) = 'operator'
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND actor_user_id = current_setting('app.user_id', true)
    )
  );

GRANT USAGE ON TYPE feature_billing_type, tenant_plan_status, feature_flag_source, feature_contract_event_operation, feature_grant_approval_status TO cocolo_app;
GRANT SELECT, INSERT, UPDATE ON tenant_plans TO cocolo_app;
GRANT SELECT ON feature_definitions TO cocolo_app;
GRANT SELECT ON feature_plan_definitions TO cocolo_app;
GRANT SELECT ON tenant_billing_accounts TO cocolo_app;
GRANT SELECT ON feature_grant_approvals TO cocolo_app;
GRANT UPDATE (status, consumed_at) ON feature_grant_approvals TO cocolo_app;
GRANT SELECT, INSERT ON feature_contract_events TO cocolo_app;
GRANT SELECT, INSERT, UPDATE ON tenant_feature_flags TO cocolo_app;

COMMENT ON TABLE feature_definitions IS '課金区分と初期値を持つ機能定義の正本';
COMMENT ON TABLE feature_plan_definitions IS 'サーバー側で管理するプランと許可featureの正本';
COMMENT ON TABLE tenant_billing_accounts IS '課金provider外部アカウントとtenantの不変な紐付け。アプリから変更しない';
COMMENT ON TABLE feature_grant_approvals IS '有償featureの手動付与に必要な課金状態と運用者承認の一回限り台帳';
COMMENT ON TABLE tenant_plans IS 'チームの契約プランと有効期間。課金providerの識別子は外部連携用';
COMMENT ON TABLE tenant_feature_flags IS 'チーム単位の機能上書きと変更監査の入口';
COMMENT ON TABLE feature_contract_events IS '課金連携イベントの冪等性と順序を記録する台帳';
COMMENT ON COLUMN tenant_plans.feature_keys IS 'このプランで利用を許可するfeature keyのスナップショット';
COMMENT ON COLUMN tenant_feature_flags.changed_by_user_id IS 'flag変更を実行したチーム利用者';
