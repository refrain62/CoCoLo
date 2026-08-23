-- Phase 2のRLSをtransaction-local設定だけに依存させず、active membershipをDBで再確認する。
CREATE OR REPLACE FUNCTION app_is_active_member(
  p_tenant_id uuid,
  p_user_id varchar(128)
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.tenant_memberships
     WHERE tenant_id = p_tenant_id
       AND user_id = p_user_id
       AND status = 'active'::public.membership_status
  )
$$;

CREATE OR REPLACE FUNCTION app_is_active_member_with_role(
  p_tenant_id uuid,
  p_user_id varchar(128),
  p_role varchar(32)
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.tenant_memberships
     WHERE tenant_id = p_tenant_id
       AND user_id = p_user_id
       AND status = 'active'::public.membership_status
       AND role::text = p_role
  )
$$;

REVOKE ALL ON FUNCTION app_is_active_member(uuid, varchar(128)) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_is_active_member_with_role(uuid, varchar(128), varchar(32)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_active_member(uuid, varchar(128)) TO cocolo_app;
GRANT EXECUTE ON FUNCTION app_is_active_member_with_role(uuid, varchar(128), varchar(32)) TO cocolo_app;

COMMENT ON FUNCTION app_is_active_member(uuid, varchar(128)) IS 'RLSからactive membershipの存在だけを判定するsecurity definer関数';
COMMENT ON FUNCTION app_is_active_member_with_role(uuid, varchar(128), varchar(32)) IS 'RLSからactive membershipとDB上のrole一致を判定するsecurity definer関数';

ALTER TABLE events
  ADD CONSTRAINT events_tenant_attachment_fk
  FOREIGN KEY (tenant_id, announcement_image_attachment_id)
  REFERENCES attachments(tenant_id, id)
  ON DELETE RESTRICT;

COMMENT ON CONSTRAINT events_tenant_attachment_fk ON events IS '予定は同一tenantの添付だけを参照する';

ALTER TABLE attendance_responses
  DROP CONSTRAINT IF EXISTS attendance_responses_tenant_id_event_id_user_id_member_id_key;
DROP INDEX IF EXISTS attendance_responses_tenant_id_event_id_user_id_member_id_key;

-- 既存データが複数actor回答を持つ場合は最後に更新された回答を残してから制約を追加する。
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tenant_id, event_id, member_id
      ORDER BY updated_at DESC, id DESC
    ) AS row_number
  FROM attendance_responses
)
DELETE FROM attendance_responses AS responses
USING ranked
WHERE responses.id = ranked.id
  AND ranked.row_number > 1;

ALTER TABLE attendance_responses
  ADD CONSTRAINT attendance_responses_tenant_event_member_key
  UNIQUE (tenant_id, event_id, member_id);

COMMENT ON CONSTRAINT attendance_responses_tenant_event_member_key ON attendance_responses IS '同一tenantの同一予定・同一部員には現在回答を1件だけ保持する';

CREATE OR REPLACE FUNCTION app_guard_attendance_response()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  deadline timestamptz;
  role_name text := current_setting('app.role', true);
  actor_user_id text := current_setting('app.user_id', true);
BEGIN
  IF NOT app_is_active_member_with_role(NEW.tenant_id, actor_user_id, role_name) THEN
    RAISE EXCEPTION '出欠回答の所属またはroleが不正です';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.id <> NEW.id
      OR OLD.tenant_id <> NEW.tenant_id
      OR OLD.event_id <> NEW.event_id
      OR OLD.user_id <> NEW.user_id
      OR OLD.member_id <> NEW.member_id THEN
      RAISE EXCEPTION '出欠回答の識別子と所属は変更できません';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.user_id <> actor_user_id THEN
    RAISE EXCEPTION '出欠回答の回答者は実行者に固定されます';
  END IF;
  SELECT attendance_deadline INTO deadline
  FROM events
  WHERE tenant_id = NEW.tenant_id AND id = NEW.event_id;
  IF deadline IS NULL THEN
    RAISE EXCEPTION '出欠回答の予定が見つかりません';
  END IF;
  IF now() > deadline AND role_name = 'guardian' THEN
    RAISE EXCEPTION '出欠締切後はguardianの回答を変更できません';
  END IF;
  IF now() > deadline
    AND role_name IN ('owner', 'admin', 'staff')
    AND NULLIF(trim(NEW.correction_reason), '') IS NULL THEN
    RAISE EXCEPTION '締切後の管理者修正には理由が必要です';
  END IF;
  IF now() <= deadline THEN
    NEW.correction_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP POLICY events_select ON events;
CREATE POLICY events_select ON events
  FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_active_member(tenant_id, current_setting('app.user_id', true))
  );

DROP POLICY events_insert ON events;
CREATE POLICY events_insert ON events
  FOR INSERT
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_active_member_with_role(tenant_id, current_setting('app.user_id', true), current_setting('app.role', true))
    AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
    AND created_by_user_id = current_setting('app.user_id', true)
    AND updated_by_user_id = current_setting('app.user_id', true)
  );

DROP POLICY events_update ON events;
CREATE POLICY events_update ON events
  FOR UPDATE
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_active_member_with_role(tenant_id, current_setting('app.user_id', true), current_setting('app.role', true))
    AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_active_member_with_role(tenant_id, current_setting('app.user_id', true), current_setting('app.role', true))
    AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
    AND updated_by_user_id = current_setting('app.user_id', true)
  );

DROP POLICY attendance_select ON attendance_responses;
CREATE POLICY attendance_select ON attendance_responses
  FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_active_member(tenant_id, current_setting('app.user_id', true))
    AND (
      app_is_active_member_with_role(tenant_id, current_setting('app.user_id', true), current_setting('app.role', true))
      AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
      OR (
        current_setting('app.role', true) = 'guardian'
        AND app_is_active_member_with_role(tenant_id, current_setting('app.user_id', true), 'guardian')
        AND EXISTS (
          SELECT 1 FROM guardian_members
          WHERE guardian_members.tenant_id = attendance_responses.tenant_id
            AND guardian_members.user_id = current_setting('app.user_id', true)
            AND guardian_members.member_id = attendance_responses.member_id
        )
      )
    )
  );

DROP POLICY attendance_insert ON attendance_responses;
CREATE POLICY attendance_insert ON attendance_responses
  FOR INSERT
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_active_member(tenant_id, current_setting('app.user_id', true))
    AND user_id = current_setting('app.user_id', true)
    AND (
      app_is_active_member_with_role(tenant_id, current_setting('app.user_id', true), current_setting('app.role', true))
      AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
      OR (
        current_setting('app.role', true) = 'guardian'
        AND app_is_active_member_with_role(tenant_id, current_setting('app.user_id', true), 'guardian')
        AND EXISTS (
          SELECT 1 FROM guardian_members
          WHERE guardian_members.tenant_id = attendance_responses.tenant_id
            AND guardian_members.user_id = current_setting('app.user_id', true)
            AND guardian_members.member_id = attendance_responses.member_id
        )
      )
    )
  );

DROP POLICY attendance_update ON attendance_responses;
CREATE POLICY attendance_update ON attendance_responses
  FOR UPDATE
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_active_member(tenant_id, current_setting('app.user_id', true))
    AND (
      app_is_active_member_with_role(tenant_id, current_setting('app.user_id', true), current_setting('app.role', true))
      AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
      OR (
        current_setting('app.role', true) = 'guardian'
        AND app_is_active_member_with_role(tenant_id, current_setting('app.user_id', true), 'guardian')
        AND EXISTS (
          SELECT 1 FROM guardian_members
          WHERE guardian_members.tenant_id = attendance_responses.tenant_id
            AND guardian_members.user_id = current_setting('app.user_id', true)
            AND guardian_members.member_id = attendance_responses.member_id
        )
      )
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_active_member(tenant_id, current_setting('app.user_id', true))
    AND (
      app_is_active_member_with_role(tenant_id, current_setting('app.user_id', true), current_setting('app.role', true))
      AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
      OR (
        current_setting('app.role', true) = 'guardian'
        AND app_is_active_member_with_role(tenant_id, current_setting('app.user_id', true), 'guardian')
        AND EXISTS (
          SELECT 1 FROM guardian_members
          WHERE guardian_members.tenant_id = attendance_responses.tenant_id
            AND guardian_members.user_id = current_setting('app.user_id', true)
            AND guardian_members.member_id = attendance_responses.member_id
        )
      )
    )
  );

COMMENT ON POLICY events_select ON events IS 'active membershipのtenantだけ予定を読み取れる';
COMMENT ON POLICY events_insert ON events IS 'active managerだけ予定を登録できる';
COMMENT ON POLICY events_update ON events IS 'active managerだけ予定を編集できる';
COMMENT ON POLICY attendance_select ON attendance_responses IS 'active所属かつmanagerまたは担当guardianだけ出欠を読み取れる';
COMMENT ON POLICY attendance_insert ON attendance_responses IS 'active所属かつmanagerまたは担当guardianだけ出欠を登録できる';
COMMENT ON POLICY attendance_update ON attendance_responses IS 'active所属かつmanagerまたは担当guardianだけ出欠を更新できる';
