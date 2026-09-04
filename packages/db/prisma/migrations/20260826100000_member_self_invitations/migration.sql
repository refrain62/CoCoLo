-- 招待単位で本人linkとguardian linkを区別し、受諾時のlink typeをDB境界へ渡す。

ALTER TABLE auth_invitations
  ADD COLUMN link_type member_link_type NOT NULL DEFAULT 'guardian'::member_link_type;

CREATE INDEX auth_invitations_tenant_link_type_idx
  ON auth_invitations(tenant_id, link_type, status);

DROP POLICY IF EXISTS guardian_members_invitation_insert ON guardian_members;
CREATE POLICY guardian_members_invitation_insert ON guardian_members
  FOR INSERT
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = current_setting('app.user_id', true)
    AND link_type = NULLIF(current_setting('app.invitation_link_type', true), '')::member_link_type
    AND status = 'active'::member_link_status
    AND current_setting('app.invitation_accepting', true) = 'true'
  );

DROP POLICY IF EXISTS guardian_members_invitation_update ON guardian_members;
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
    AND link_type = NULLIF(current_setting('app.invitation_link_type', true), '')::member_link_type
    AND status = 'active'::member_link_status
    AND current_setting('app.invitation_accepting', true) = 'true'
  );

COMMENT ON COLUMN auth_invitations.link_type IS '本人linkまたはguardian linkとして受諾する種別';
