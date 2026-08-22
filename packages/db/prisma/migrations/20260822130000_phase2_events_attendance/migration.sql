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

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_responses FORCE ROW LEVEL SECURITY;

CREATE POLICY events_select ON events
  FOR SELECT
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY events_write ON events
  FOR ALL
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
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
