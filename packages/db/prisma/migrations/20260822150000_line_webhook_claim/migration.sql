-- 外部Webhookは利用者のJWTを持たないため、接続先解決と重複排除だけをSECURITY DEFINERへ限定する。
-- tenant_idや本文を返さず、署名・destination検証済みのAPIからだけ呼び出す。
CREATE OR REPLACE FUNCTION app_claim_line_webhook(
  p_group_id varchar(128),
  p_webhook_event_id varchar(128),
  p_received_at timestamptz
)
RETURNS TABLE (accepted boolean, duplicate boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  connected_tenant_id uuid;
  inserted_count integer;
BEGIN
  IF p_group_id IS NULL OR p_webhook_event_id IS NULL
     OR length(trim(p_group_id)) = 0
     OR length(trim(p_webhook_event_id)) = 0 THEN
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;

  SELECT tenant_id
    INTO connected_tenant_id
    FROM line_connections
   WHERE group_id = p_group_id
     AND status = 'connected'::line_connection_status
   LIMIT 1;

  IF connected_tenant_id IS NULL THEN
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;

  INSERT INTO line_webhook_receipts (
    tenant_id, group_id, webhook_event_id, received_at
  ) VALUES (
    connected_tenant_id, p_group_id, p_webhook_event_id, p_received_at
  ) ON CONFLICT (group_id, webhook_event_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN QUERY SELECT inserted_count = 1, inserted_count = 0;
END;
$$;

REVOKE ALL ON FUNCTION app_claim_line_webhook(varchar, varchar, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_claim_line_webhook(varchar, varchar, timestamptz) TO cocolo_app;

COMMENT ON FUNCTION app_claim_line_webhook(varchar, varchar, timestamptz)
  IS '署名検証済みLINE Webhookの接続group解決と重複排除を一体化する。tenant IDは返さない。';
