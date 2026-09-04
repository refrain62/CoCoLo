-- JWT subjectだけで所属を解決できるようにし、tenant context未設定時は本人のmembershipだけを返す。
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

-- guardianはGuardianMemberで担当する部員だけをSELECTできる。DTO投影だけに依存しない。
DROP POLICY IF EXISTS members_select ON members;
CREATE POLICY members_select ON members
  FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND (
      current_setting('app.role', true) IN ('owner', 'admin', 'staff')
      OR (
        current_setting('app.role', true) = 'guardian'
        AND EXISTS (
          SELECT 1
          FROM guardian_members
          WHERE guardian_members.tenant_id = members.tenant_id
            AND guardian_members.member_id = members.id
            AND guardian_members.user_id = current_setting('app.user_id', true)
        )
      )
    )
  );
