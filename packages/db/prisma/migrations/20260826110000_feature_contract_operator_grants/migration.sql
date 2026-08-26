-- 課金連携の承認台帳と運用者listenerを、適用済みのfeature契約migrationへ追加する。

CREATE TYPE feature_contract_event_operation AS ENUM ('plan_sync', 'paid_grant');
CREATE TYPE feature_grant_approval_status AS ENUM ('approved', 'consumed', 'revoked');

ALTER TABLE tenant_plans
  ADD COLUMN provider_version integer NOT NULL DEFAULT 0;

ALTER TABLE tenant_feature_flags
  ADD COLUMN provider_version integer NOT NULL DEFAULT 0;

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

CREATE INDEX feature_contract_events_tenant_operation_version_idx
  ON feature_contract_events(tenant_id, operation, version);
CREATE INDEX feature_grant_approvals_tenant_provider_status_idx
  ON feature_grant_approvals(tenant_id, provider_account_id, status);
CREATE INDEX feature_grant_approvals_tenant_feature_status_idx
  ON feature_grant_approvals(tenant_id, feature_key, status);
CREATE INDEX feature_contract_events_tenant_approval_idx
  ON feature_contract_events(tenant_id, approval_id);

INSERT INTO feature_plan_definitions (plan_key, feature_keys)
VALUES
  ('free', ARRAY['members', 'events-attendance', 'bulletin-board', 'attachments']),
  ('standard', ARRAY['members', 'events-attendance', 'bulletin-board', 'attachments', 'orders-payments']),
  ('premium', ARRAY['members', 'events-attendance', 'bulletin-board', 'attachments', 'orders-payments', 'line-notifications', 'ride-operations'])
ON CONFLICT (plan_key) DO NOTHING;

ALTER TABLE feature_plan_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_plan_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_billing_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE feature_grant_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_grant_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE feature_contract_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_contract_events FORCE ROW LEVEL SECURITY;

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

GRANT USAGE ON TYPE feature_contract_event_operation, feature_grant_approval_status TO cocolo_app;
GRANT SELECT ON feature_plan_definitions TO cocolo_app;
GRANT SELECT ON tenant_billing_accounts TO cocolo_app;
GRANT SELECT ON feature_grant_approvals TO cocolo_app;
GRANT UPDATE (status, consumed_at) ON feature_grant_approvals TO cocolo_app;
GRANT SELECT, INSERT ON feature_contract_events TO cocolo_app;

COMMENT ON TABLE feature_plan_definitions IS 'サーバー側で管理するプランと許可featureの正本';
COMMENT ON TABLE tenant_billing_accounts IS '課金provider外部アカウントとtenantの不変な紐付け。アプリから変更しない';
COMMENT ON TABLE feature_grant_approvals IS '有償featureの手動付与に必要な課金状態と運用者承認の一回限り台帳';
COMMENT ON TABLE feature_contract_events IS '課金連携イベントの冪等性と順序を記録する台帳';
COMMENT ON COLUMN tenant_plans.provider_version IS '課金providerから同期したプランの単調増加version';
COMMENT ON COLUMN tenant_feature_flags.provider_version IS '課金providerから同期したflagの単調増加version';
