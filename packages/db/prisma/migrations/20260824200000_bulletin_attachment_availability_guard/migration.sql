-- 回覧板へ紐付ける添付は、検証済みのavailable状態だけに限定する。
-- 既存データに不正な紐付けがあれば、黙って通さずmigration自体を停止する。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM announcement_attachments AS aa
    LEFT JOIN attachments AS a
      ON a.tenant_id = aa.tenant_id
     AND a.id = aa.attachment_id
    WHERE a.id IS NULL
       OR a.status <> 'available'::attachment_status
  ) THEN
    RAISE EXCEPTION '回覧板にavailable以外の添付紐付けが存在します';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_guard_announcement_attachment_availability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_status attachment_status;
BEGIN
  SELECT status
    INTO current_status
    FROM attachments
   WHERE tenant_id = NEW.tenant_id
     AND id = NEW.attachment_id
   FOR KEY SHARE;

  IF current_status IS DISTINCT FROM 'available'::attachment_status THEN
    RAISE EXCEPTION '回覧板にはavailable状態の添付だけを紐付けできます';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_guard_announcement_attachment_availability() FROM PUBLIC, cocolo_app;

DROP TRIGGER IF EXISTS announcement_attachment_availability_guard ON announcement_attachments;
CREATE TRIGGER announcement_attachment_availability_guard
BEFORE INSERT OR UPDATE ON announcement_attachments
FOR EACH ROW
EXECUTE FUNCTION app_guard_announcement_attachment_availability();

COMMENT ON FUNCTION app_guard_announcement_attachment_availability() IS
  '回覧板へ紐付ける添付をavailable状態に限定する';
COMMENT ON TRIGGER announcement_attachment_availability_guard ON announcement_attachments IS
  '回覧板添付の検証済み状態をDBで強制する';

CREATE OR REPLACE FUNCTION app_guard_referenced_attachment_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'available'::attachment_status
     AND NEW.status <> 'available'::attachment_status
     AND EXISTS (
       SELECT 1
       FROM announcement_attachments
       WHERE tenant_id = OLD.tenant_id
         AND attachment_id = OLD.id
     ) THEN
    RAISE EXCEPTION '回覧板に紐付く添付の状態はavailableから変更できません';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_guard_referenced_attachment_state() FROM PUBLIC, cocolo_app;

DROP TRIGGER IF EXISTS referenced_attachment_state_guard ON attachments;
CREATE TRIGGER referenced_attachment_state_guard
BEFORE UPDATE ON attachments
FOR EACH ROW
EXECUTE FUNCTION app_guard_referenced_attachment_state();

COMMENT ON FUNCTION app_guard_referenced_attachment_state() IS
  '回覧板に紐付く添付をavailable状態から戻さない';
COMMENT ON TRIGGER referenced_attachment_state_guard ON attachments IS
  '回覧板参照中の添付状態遷移をDBで強制する';
