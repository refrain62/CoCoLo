CREATE TYPE attachment_status AS ENUM ('uploaded', 'available', 'rejected', 'deleted');

CREATE TABLE attachments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  owner_user_id varchar(128) NOT NULL,
  object_key varchar(512) NOT NULL,
  media_type varchar(100) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 20971520),
  sha256 char(64),
  status attachment_status NOT NULL DEFAULT 'uploaded',
  expires_at timestamptz NOT NULL,
  complete_attempts smallint NOT NULL DEFAULT 0 CHECK (complete_attempts BETWEEN 0 AND 3),
  cleanup_attempts smallint NOT NULL DEFAULT 0,
  cleanup_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, object_key),
  CHECK (media_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  CHECK ((status = 'available' AND sha256 IS NOT NULL AND available_at IS NOT NULL) OR status <> 'available'),
  CHECK ((status = 'deleted' AND deleted_at IS NOT NULL) OR status <> 'deleted'),
  CHECK (cleanup_completed_at IS NULL OR status = 'rejected')
);

CREATE INDEX attachments_tenant_status_idx ON attachments(tenant_id, status, created_at);
CREATE INDEX attachments_cleanup_idx ON attachments(status, cleanup_completed_at)
  WHERE status = 'rejected' AND cleanup_completed_at IS NULL;

COMMENT ON TABLE attachments IS 'テナント内の非公開添付メタデータ。オブジェクト本体はR2に保存する';
COMMENT ON COLUMN attachments.owner_user_id IS 'アップロード開始時の認証済み所有者。リクエスト本文から設定しない';
COMMENT ON COLUMN attachments.object_key IS '公開URLではなくR2内部のテナント分離キー';
COMMENT ON COLUMN attachments.complete_attempts IS '同一セッションの完了検証回数。最大3回';
COMMENT ON COLUMN attachments.cleanup_completed_at IS 'rejected本体の削除成功時刻。deletedAtとは別のcleanup記録';

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments FORCE ROW LEVEL SECURITY;

CREATE POLICY attachments_select ON attachments
  FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND (
      owner_user_id = current_setting('app.user_id', true)
      OR current_setting('app.role', true) IN ('owner', 'admin', 'staff')
    )
  );

CREATE POLICY attachments_insert ON attachments
  FOR INSERT
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND owner_user_id = current_setting('app.user_id', true)
    AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
  );

CREATE POLICY attachments_update ON attachments
  FOR UPDATE
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND (
      owner_user_id = current_setting('app.user_id', true)
      OR current_setting('app.role', true) IN ('owner', 'admin', 'staff')
    )
  )
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY attachments_delete ON attachments
  FOR DELETE
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND current_setting('app.role', true) IN ('owner', 'admin', 'staff')
  );

CREATE OR REPLACE FUNCTION app_guard_attachment_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'uploaded'::attachment_status OR NEW.sha256 IS NOT NULL OR NEW.available_at IS NOT NULL THEN
      RAISE EXCEPTION '添付セッションはuploadedかつ未検証で開始する必要があります';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.tenant_id <> NEW.tenant_id
    OR OLD.owner_user_id <> NEW.owner_user_id
    OR OLD.object_key <> NEW.object_key
    OR OLD.media_type <> NEW.media_type
    OR OLD.byte_size <> NEW.byte_size
    OR OLD.expires_at <> NEW.expires_at THEN
    RAISE EXCEPTION '添付セッションの境界項目は変更できません';
  END IF;

  IF OLD.status = 'uploaded'::attachment_status AND NEW.status NOT IN ('uploaded', 'available', 'rejected') THEN
    RAISE EXCEPTION 'uploadedから不正な添付状態へ変更できません';
  END IF;
  IF OLD.status <> 'uploaded'::attachment_status AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION '検証後の添付状態は変更できません';
  END IF;
  IF NEW.status = 'available'::attachment_status
    AND (NEW.sha256 IS NULL OR NEW.available_at IS NULL OR NEW.complete_attempts > 3) THEN
    RAISE EXCEPTION 'availableには検証済み情報と時刻が必要です';
  END IF;
  IF NEW.status = 'rejected'::attachment_status
    AND (NEW.available_at IS NOT NULL OR NEW.deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'rejectedに配信・削除済み時刻は設定できません';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION app_guard_attachment_transition() IS '添付のuploadedからavailable/rejectedだけを許可し、境界項目を固定する';

CREATE TRIGGER attachment_state_guard
BEFORE INSERT OR UPDATE ON attachments
FOR EACH ROW
EXECUTE FUNCTION app_guard_attachment_transition();

COMMENT ON TRIGGER attachment_state_guard ON attachments IS '添付セッションの状態遷移と所有境界をDBでも強制する';

GRANT USAGE ON TYPE attachment_status TO cocolo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON attachments TO cocolo_app;
