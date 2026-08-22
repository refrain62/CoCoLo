CREATE TYPE event_type AS ENUM ('practice', 'match', 'event');
CREATE TYPE attendance_response AS ENUM ('attending', 'absent', 'pending');

CREATE TABLE events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  title varchar(200) NOT NULL,
  event_type event_type NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  location varchar(500),
  items_to_bring varchar(2000),
  fee integer NOT NULL DEFAULT 0 CHECK (fee >= 0),
  announcement_image_attachment_id uuid,
  opponent varchar(200),
  meeting_time timestamptz,
  transportation_required boolean NOT NULL DEFAULT false,
  attendance_deadline timestamptz NOT NULL,
  created_by_user_id varchar(128) NOT NULL,
  updated_by_user_id varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ends_at > starts_at),
  CHECK (attendance_deadline <= starts_at),
  CHECK (meeting_time IS NULL OR meeting_time <= starts_at),
  CHECK (event_type <> 'match'::event_type OR opponent IS NOT NULL)
);

CREATE TABLE attendance_responses (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  event_id uuid NOT NULL,
  user_id varchar(128) NOT NULL,
  member_id uuid NOT NULL,
  response attendance_response NOT NULL,
  correction_reason varchar(500),
  responded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, event_id, user_id, member_id),
  FOREIGN KEY (tenant_id, event_id) REFERENCES events(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, member_id) REFERENCES members(tenant_id, id) ON DELETE RESTRICT,
  CHECK (correction_reason IS NULL OR length(trim(correction_reason)) > 0)
);

CREATE INDEX events_tenant_start_idx ON events(tenant_id, starts_at, id);
CREATE INDEX attendance_responses_event_idx ON attendance_responses(tenant_id, event_id, member_id);
CREATE INDEX attendance_responses_user_idx ON attendance_responses(tenant_id, user_id, member_id);

COMMENT ON TABLE events IS 'チーム内の練習・試合・イベント予定';
COMMENT ON TABLE attendance_responses IS 'イベントごとの部員別出欠回答。締切後の修正理由を保持する';
COMMENT ON COLUMN events.attendance_deadline IS 'サーバー時刻で回答可否を判定する締切';
COMMENT ON COLUMN events.announcement_image_attachment_id IS '将来の非公開添付を参照するID。公開URLは保存しない';
COMMENT ON COLUMN attendance_responses.correction_reason IS '締切後にowner/admin/staffが修正した理由';

CREATE OR REPLACE FUNCTION app_guard_event_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.id <> NEW.id
    OR OLD.tenant_id <> NEW.tenant_id
    OR OLD.created_by_user_id <> NEW.created_by_user_id THEN
    RAISE EXCEPTION '予定の識別子、tenant、作成者は変更できません';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_identity_guard
BEFORE UPDATE ON events
FOR EACH ROW
EXECUTE FUNCTION app_guard_event_identity();

CREATE OR REPLACE FUNCTION app_guard_attendance_response()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  deadline timestamptz;
  role_name text := current_setting('app.role', true);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.id <> NEW.id
      OR OLD.tenant_id <> NEW.tenant_id
      OR OLD.event_id <> NEW.event_id
      OR OLD.user_id <> NEW.user_id
      OR OLD.member_id <> NEW.member_id THEN
      RAISE EXCEPTION '出欠回答の識別子と所属は変更できません';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.user_id <> current_setting('app.user_id', true) THEN
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

CREATE TRIGGER attendance_response_guard
BEFORE INSERT OR UPDATE ON attendance_responses
FOR EACH ROW
EXECUTE FUNCTION app_guard_attendance_response();

COMMENT ON FUNCTION app_guard_event_identity() IS '予定のtenant、ID、作成者を固定';
COMMENT ON FUNCTION app_guard_attendance_response() IS '出欠回答の主体、締切、締切後修正理由をDBで強制';

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_responses FORCE ROW LEVEL SECURITY;

CREATE POLICY events_select ON events
  FOR SELECT
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY events_insert ON events
  FOR INSERT
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
    AND created_by_user_id = current_setting('app.user_id', true)
    AND updated_by_user_id = current_setting('app.user_id', true)
  );
CREATE POLICY events_update ON events
  FOR UPDATE
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
    AND updated_by_user_id = current_setting('app.user_id', true)
  );

CREATE POLICY attendance_select ON attendance_responses
  FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND (
      current_setting('app.role', true) IN ('owner', 'admin', 'staff')
      OR (
        user_id = current_setting('app.user_id', true)
        AND EXISTS (
          SELECT 1 FROM guardian_members
          WHERE guardian_members.tenant_id = attendance_responses.tenant_id
            AND guardian_members.user_id = current_setting('app.user_id', true)
            AND guardian_members.member_id = attendance_responses.member_id
        )
      )
    )
  );
CREATE POLICY attendance_insert ON attendance_responses
  FOR INSERT
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND (
      (
        current_setting('app.role', true) IN ('owner', 'admin', 'staff')
        AND user_id = current_setting('app.user_id', true)
      )
      OR (
        user_id = current_setting('app.user_id', true)
        AND EXISTS (
          SELECT 1 FROM guardian_members
          WHERE guardian_members.tenant_id = attendance_responses.tenant_id
            AND guardian_members.user_id = current_setting('app.user_id', true)
            AND guardian_members.member_id = attendance_responses.member_id
        )
      )
    )
  );
CREATE POLICY attendance_update ON attendance_responses
  FOR UPDATE
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND (
      current_setting('app.role', true) IN ('owner', 'admin', 'staff')
      OR (
        user_id = current_setting('app.user_id', true)
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
    AND (
      current_setting('app.role', true) IN ('owner', 'admin', 'staff')
      OR (
        user_id = current_setting('app.user_id', true)
        AND EXISTS (
          SELECT 1 FROM guardian_members
          WHERE guardian_members.tenant_id = attendance_responses.tenant_id
            AND guardian_members.user_id = current_setting('app.user_id', true)
            AND guardian_members.member_id = attendance_responses.member_id
        )
      )
    )
  );

GRANT SELECT, INSERT, UPDATE ON events, attendance_responses TO cocolo_app;
