CREATE TYPE announcement_status AS ENUM ('published', 'archived');

CREATE TABLE announcements (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  author_user_id varchar(128) NOT NULL,
  title varchar(200) NOT NULL,
  body text NOT NULL,
  status announcement_status NOT NULL DEFAULT 'published',
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CHECK (length(btrim(body)) BETWEEN 1 AND 20000)
);

CREATE TABLE announcement_attachments (
  tenant_id uuid NOT NULL,
  announcement_id uuid NOT NULL,
  attachment_id uuid NOT NULL,
  position smallint NOT NULL,
  media_type varchar(100) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 20971520),
  PRIMARY KEY (tenant_id, announcement_id, attachment_id),
  UNIQUE (tenant_id, announcement_id, position),
  FOREIGN KEY (tenant_id, announcement_id)
    REFERENCES announcements(tenant_id, id) ON DELETE CASCADE,
  CHECK (position BETWEEN 0 AND 9),
  CHECK (media_type IN ('image/jpeg', 'image/png', 'application/pdf'))
);

CREATE TABLE announcement_reads (
  tenant_id uuid NOT NULL,
  announcement_id uuid NOT NULL,
  user_id varchar(128) NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, announcement_id, user_id),
  FOREIGN KEY (tenant_id, announcement_id)
    REFERENCES announcements(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX announcements_tenant_status_published_idx
  ON announcements(tenant_id, status, published_at DESC, id DESC);
CREATE INDEX announcement_attachments_tenant_announcement_idx
  ON announcement_attachments(tenant_id, announcement_id, position);
CREATE INDEX announcement_reads_tenant_announcement_idx
  ON announcement_reads(tenant_id, announcement_id, read_at);
CREATE INDEX announcement_reads_tenant_user_idx
  ON announcement_reads(tenant_id, user_id, read_at);

COMMENT ON TABLE announcements IS 'テナント内で公開する回覧板。本文と掲載者を保持する';
COMMENT ON TABLE announcement_attachments IS '回覧掲載時に検証した添付メタデータのスナップショット';
COMMENT ON TABLE announcement_reads IS 'ユーザー単位の回覧初回確認時刻。テナント複合キーで分離する';
COMMENT ON COLUMN announcements.author_user_id IS '認証済み掲載者。リクエスト本文から設定しない';
COMMENT ON COLUMN announcement_attachments.attachment_id IS '添付adapterが同一テナントのavailable状態を検証したID';
COMMENT ON COLUMN announcement_attachments.media_type IS '公開URLやオブジェクトキーを返さないための表示用MIME';
COMMENT ON COLUMN announcement_reads.read_at IS '初回既読時刻。再送では更新せず、監査の時系列を固定する';

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements FORCE ROW LEVEL SECURITY;
ALTER TABLE announcement_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_attachments FORCE ROW LEVEL SECURITY;
ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_reads FORCE ROW LEVEL SECURITY;

-- RLS policyからの所属・掲載者判定を安全な関数へ隔離し、相互参照によるpolicy再帰を避ける。
CREATE OR REPLACE FUNCTION app_is_active_announcement_member(
  requested_tenant_id uuid,
  requested_user_id varchar(128)
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tenant_memberships
    WHERE tenant_id = requested_tenant_id
      AND user_id = requested_user_id
      AND status = 'active'::membership_status
  )
$$;

CREATE OR REPLACE FUNCTION app_is_announcement_author(
  requested_tenant_id uuid,
  requested_announcement_id uuid,
  requested_user_id varchar(128)
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM announcements
    WHERE tenant_id = requested_tenant_id
      AND id = requested_announcement_id
      AND author_user_id = requested_user_id
      AND status = 'published'::announcement_status
      AND app_is_active_announcement_member(requested_tenant_id, requested_user_id)
  )
$$;

COMMENT ON FUNCTION app_is_active_announcement_member(uuid, varchar) IS '回覧板操作のtransaction内でactive membershipを判定する';
COMMENT ON FUNCTION app_is_announcement_author(uuid, uuid, varchar) IS '指定回覧の掲載者本人かをRLS policyから判定する';
REVOKE ALL ON FUNCTION app_is_active_announcement_member(uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_is_announcement_author(uuid, uuid, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_active_announcement_member(uuid, varchar) TO cocolo_app;
GRANT EXECUTE ON FUNCTION app_is_announcement_author(uuid, uuid, varchar) TO cocolo_app;

CREATE POLICY announcements_select ON announcements
  FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND status = 'published'::announcement_status
    AND app_is_active_announcement_member(
      tenant_id,
      current_setting('app.user_id', true)
    )
  );

CREATE POLICY announcements_insert ON announcements
  FOR INSERT
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND author_user_id = current_setting('app.user_id', true)
    AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
    AND status = 'published'::announcement_status
    AND app_is_active_announcement_member(tenant_id, author_user_id)
  );

CREATE POLICY announcement_attachments_select ON announcement_attachments
  FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND app_is_active_announcement_member(
      tenant_id,
      current_setting('app.user_id', true)
    )
    AND EXISTS (
      SELECT 1
      FROM announcements
      WHERE announcements.tenant_id = announcement_attachments.tenant_id
        AND announcements.id = announcement_attachments.announcement_id
        AND announcements.status = 'published'::announcement_status
    )
  );

CREATE POLICY announcement_attachments_insert ON announcement_attachments
  FOR INSERT
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
    AND app_is_announcement_author(
      tenant_id,
      announcement_id,
      current_setting('app.user_id', true)
    )
  );

CREATE POLICY announcement_reads_select ON announcement_reads
  FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM announcements
      WHERE announcements.tenant_id = announcement_reads.tenant_id
        AND announcements.id = announcement_reads.announcement_id
        AND announcements.status = 'published'::announcement_status
    )
    AND (
      user_id = current_setting('app.user_id', true)
      OR app_is_announcement_author(
        tenant_id,
        announcement_id,
        current_setting('app.user_id', true)
      )
    )
  );

CREATE POLICY announcement_reads_insert ON announcement_reads
  FOR INSERT
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = current_setting('app.user_id', true)
    AND app_is_active_announcement_member(tenant_id, user_id)
    AND EXISTS (
      SELECT 1
      FROM announcements
      WHERE announcements.tenant_id = announcement_reads.tenant_id
        AND announcements.id = announcement_reads.announcement_id
        AND announcements.status = 'published'::announcement_status
    )
  );

-- 既存のmembership policyは本人の所属だけを返す。未読一覧ではtransaction-localな回覧IDと掲載者判定を追加条件にする。
CREATE POLICY tenant_memberships_announcement_author_select ON tenant_memberships
  FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND status = 'active'::membership_status
    AND NULLIF(current_setting('app.announcement_id', true), '') IS NOT NULL
    AND app_is_announcement_author(
      tenant_id,
      NULLIF(current_setting('app.announcement_id', true), '')::uuid,
      current_setting('app.user_id', true)
    )
  );

CREATE OR REPLACE FUNCTION app_guard_announcement_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'published'::announcement_status THEN
      RAISE EXCEPTION '回覧はpublished状態で掲載を開始する必要があります';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.tenant_id <> NEW.tenant_id
    OR OLD.id <> NEW.id
    OR OLD.author_user_id <> NEW.author_user_id
    OR OLD.published_at <> NEW.published_at THEN
    RAISE EXCEPTION '回覧のテナント・掲載者・掲載時刻は変更できません';
  END IF;
  IF OLD.status = 'archived'::announcement_status
    AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'archived状態の回覧は再公開できません';
  END IF;
  IF OLD.status = 'published'::announcement_status
    AND NEW.status <> 'published'::announcement_status
    AND NEW.status <> 'archived'::announcement_status THEN
    RAISE EXCEPTION '回覧の状態遷移が不正です';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION app_guard_announcement_transition() IS '回覧の掲載状態とテナント境界をDB側でも固定する';

CREATE TRIGGER announcement_state_guard
BEFORE INSERT OR UPDATE ON announcements
FOR EACH ROW
EXECUTE FUNCTION app_guard_announcement_transition();

COMMENT ON TRIGGER announcement_state_guard ON announcements IS '回覧の状態遷移と掲載境界を検証する';

GRANT USAGE ON TYPE announcement_status TO cocolo_app;
GRANT SELECT, INSERT ON announcements, announcement_attachments, announcement_reads TO cocolo_app;
