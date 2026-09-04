CREATE OR REPLACE FUNCTION app_record_line_webhook_receipt(
  p_group_id varchar(128),
  p_webhook_event_id varchar(128),
  p_received_at timestamptz
)
RETURNS TABLE(accepted boolean, known_group boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_tenant_id uuid;
  inserted_count integer;
  normalized_group_id varchar(128) := btrim(p_group_id);
  normalized_event_id varchar(128) := btrim(p_webhook_event_id);
BEGIN
  IF session_user <> 'line_webhook_receiver' THEN
    RAISE EXCEPTION 'LINE webhook受信roleが不正です';
  END IF;
  IF normalized_group_id = '' OR length(normalized_group_id) > 128
     OR normalized_event_id = '' OR length(normalized_event_id) > 128
     OR p_received_at IS NULL THEN
    RAISE EXCEPTION 'LINE webhook receiptの引数が不正です';
  END IF;

  SELECT c.tenant_id
    INTO target_tenant_id
    FROM line_connections c
   WHERE c.group_id = normalized_group_id
     AND c.status = 'connected'::line_connection_status
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;

  INSERT INTO line_webhook_receipts (tenant_id, group_id, webhook_event_id, received_at)
  VALUES (target_tenant_id, normalized_group_id, normalized_event_id, p_received_at)
  ON CONFLICT (group_id, webhook_event_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN QUERY SELECT inserted_count = 1, true;
END;
$$;

REVOKE ALL ON FUNCTION app_record_line_webhook_receipt(varchar, varchar, timestamptz)
  FROM PUBLIC, cocolo_app, line_delivery_worker;
GRANT EXECUTE ON FUNCTION app_record_line_webhook_receipt(varchar, varchar, timestamptz)
  TO line_webhook_receiver;

REVOKE INSERT, UPDATE, DELETE ON TABLE line_webhook_receipts FROM cocolo_app;
REVOKE ALL ON TABLE line_connections, line_webhook_receipts FROM line_webhook_receiver;
GRANT USAGE ON SCHEMA public TO line_webhook_receiver;

COMMENT ON FUNCTION app_record_line_webhook_receipt(varchar, varchar, timestamptz)
  IS 'LINE受信専用roleが接続済みgroupのWebhook receiptだけを冪等記録する';
