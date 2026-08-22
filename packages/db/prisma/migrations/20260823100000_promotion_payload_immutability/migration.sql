CREATE OR REPLACE FUNCTION app_guard_promotion_run_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'preview'::promotion_run_status THEN
      RAISE EXCEPTION 'PromotionRunはpreviewで開始する必要があります';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'completed'::promotion_run_status
    AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'completed状態の年度繰り上げpayloadは変更できません';
  END IF;
  IF OLD.tenant_id <> NEW.tenant_id OR OLD.fiscal_year <> NEW.fiscal_year THEN
    RAISE EXCEPTION 'promotion runのtenantまたは年度は変更できません';
  END IF;
  IF OLD.actor_user_id <> NEW.actor_user_id THEN
    RAISE EXCEPTION 'promotion runの実行者は変更できません';
  END IF;
  IF OLD.request_hash IS NOT NULL
    AND OLD.request_hash IS DISTINCT FROM NEW.request_hash THEN
    RAISE EXCEPTION '年度繰り上げ実行のリクエストハッシュは変更できません。';
  END IF;
  IF OLD.idempotency_key IS NOT NULL
    AND OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key THEN
    RAISE EXCEPTION 'promotion runのidempotency keyは変更できません';
  END IF;
  IF OLD.status = 'preview'::promotion_run_status
    AND NEW.status NOT IN (
      'preview'::promotion_run_status,
      'completed'::promotion_run_status,
      'failed'::promotion_run_status
    ) THEN
    RAISE EXCEPTION 'previewから不正な状態へ変更できません';
  END IF;
  IF OLD.status = 'failed'::promotion_run_status
    AND NEW.status NOT IN (
      'failed'::promotion_run_status,
      'completed'::promotion_run_status
    ) THEN
    RAISE EXCEPTION 'failedからpreviewへ戻せません';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION app_guard_promotion_run_transition() IS 'completed状態ではpayload全体を不変にし、年度繰り上げの状態遷移とtenant・年度固定をDBで強制';
