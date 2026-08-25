-- OAuth identity、opaque invitation、対象member linkを別責務として保存する。

CREATE TYPE auth_provider AS ENUM ('google', 'line');
CREATE TYPE auth_invitation_status AS ENUM ('pending', 'accepted', 'expired', 'revoked');
CREATE TYPE member_link_type AS ENUM ('self', 'guardian');
CREATE TYPE member_link_status AS ENUM ('invited', 'active', 'revoked', 'suspended');

CREATE TABLE auth_identities (
  id uuid PRIMARY KEY DEFAULT app_uuidv7(),
  user_id varchar(128) NOT NULL,
  provider auth_provider NOT NULL,
  provider_subject varchar(256) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (provider, provider_subject),
  UNIQUE (user_id, provider),
  CHECK (app_is_uuidv7(id))
);

CREATE TABLE auth_invitations (
  id uuid PRIMARY KEY DEFAULT app_uuidv7(),
  tenant_id uuid NOT NULL,
  member_id uuid NOT NULL,
  role role NOT NULL,
  relationship varchar(100) NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  invited_by_user_id varchar(128) NOT NULL,
  status auth_invitation_status NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by_user_id varchar(128),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, member_id) REFERENCES members(tenant_id, id) ON DELETE RESTRICT,
  CHECK (app_is_uuidv7(id)),
  CHECK (expires_at > created_at),
  CHECK (status <> 'accepted'::auth_invitation_status OR accepted_at IS NOT NULL),
  CHECK (status <> 'revoked'::auth_invitation_status OR revoked_at IS NOT NULL)
);

ALTER TABLE guardian_members
  ADD COLUMN link_type member_link_type NOT NULL DEFAULT 'guardian'::member_link_type,
  ADD COLUMN status member_link_status NOT NULL DEFAULT 'active'::member_link_status,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX auth_invitations_tenant_status_expires_idx
  ON auth_invitations(tenant_id, status, expires_at);
CREATE INDEX auth_identities_user_idx ON auth_identities(user_id);
CREATE INDEX guardian_members_tenant_status_idx
  ON guardian_members(tenant_id, status, link_type);

ALTER TABLE auth_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY auth_identities_select ON auth_identities
  FOR SELECT
  USING (user_id = current_setting('app.user_id', true));
CREATE POLICY auth_identities_insert ON auth_identities
  FOR INSERT
  WITH CHECK (user_id = current_setting('app.user_id', true));
CREATE POLICY auth_identities_update ON auth_identities
  FOR UPDATE
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));

CREATE POLICY auth_invitations_manager_select ON auth_invitations
  FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_manager()
  );
CREATE POLICY auth_invitations_token_select ON auth_invitations
  FOR SELECT
  USING (
    status = 'pending'::auth_invitation_status
    AND expires_at > now()
    AND token_hash = current_setting('app.invitation_token_hash', true)
  );
CREATE POLICY auth_invitations_manager_insert ON auth_invitations
  FOR INSERT
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_manager()
    AND invited_by_user_id = current_setting('app.user_id', true)
    AND status = 'pending'::auth_invitation_status
  );
CREATE POLICY auth_invitations_manager_update ON auth_invitations
  FOR UPDATE
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_manager()
    AND status = 'pending'::auth_invitation_status
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_manager()
    AND status = 'revoked'::auth_invitation_status
    AND revoked_at IS NOT NULL
  );
CREATE POLICY auth_invitations_accept_update ON auth_invitations
  FOR UPDATE
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND
    status = 'pending'::auth_invitation_status
    AND expires_at > now()
    AND token_hash = current_setting('app.invitation_token_hash', true)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND
    status = 'accepted'::auth_invitation_status
    AND accepted_by_user_id = current_setting('app.user_id', true)
    AND token_hash = current_setting('app.invitation_token_hash', true)
  );

CREATE POLICY tenant_memberships_invitation_insert ON tenant_memberships
  FOR INSERT
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = current_setting('app.user_id', true)
    AND current_setting('app.invitation_accepting', true) = 'true'
    AND role = 'guardian'::role
    AND status = 'active'::membership_status
  );
CREATE POLICY tenant_memberships_invitation_update ON tenant_memberships
  FOR UPDATE
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = current_setting('app.user_id', true)
    AND current_setting('app.invitation_accepting', true) = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = current_setting('app.user_id', true)
    AND role = 'guardian'::role
    AND status = 'active'::membership_status
    AND current_setting('app.invitation_accepting', true) = 'true'
  );
CREATE POLICY guardian_members_invitation_insert ON guardian_members
  FOR INSERT
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = current_setting('app.user_id', true)
    AND link_type = 'guardian'::member_link_type
    AND status = 'active'::member_link_status
    AND current_setting('app.invitation_accepting', true) = 'true'
  );
CREATE POLICY guardian_members_invitation_update ON guardian_members
  FOR UPDATE
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = current_setting('app.user_id', true)
    AND current_setting('app.invitation_accepting', true) = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = current_setting('app.user_id', true)
    AND current_setting('app.invitation_accepting', true) = 'true'
  );

GRANT USAGE ON TYPE auth_provider, auth_invitation_status, member_link_type, member_link_status TO cocolo_app;
GRANT SELECT, INSERT, UPDATE ON auth_identities, auth_invitations TO cocolo_app;
GRANT SELECT, INSERT, UPDATE ON guardian_members, tenant_memberships TO cocolo_app;

COMMENT ON TABLE auth_identities IS 'OAuth providerとSupabase利用者subjectの一意な対応。tenant所属とは分離する';
COMMENT ON TABLE auth_invitations IS '一回限りのopaque招待tokenのハッシュと受諾状態';
COMMENT ON COLUMN auth_invitations.token_hash IS 'raw tokenを保存せずSHA-256 hashだけを保存する';
COMMENT ON TABLE guardian_members IS '本人・保護者と対象memberの利用者link';
COMMENT ON COLUMN guardian_members.link_type IS '本人linkまたはguardian link';
COMMENT ON COLUMN guardian_members.status IS 'member linkの招待・有効・停止状態';
