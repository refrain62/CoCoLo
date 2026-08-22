-- unknown確定も現行attemptの有効なleaseだけに許可し、古いworkerの上書きを防ぐ。
CREATE OR REPLACE FUNCTION app_mark_line_delivery_unknown(
  p_tenant_id uuid,
  p_notification_id uuid,
  p_attempt_token uuid,
  p_error_code varchar(32)
)
RETURNS TABLE (outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  updated boolean;
BEGIN
  IF session_user <> 'line_delivery_worker' THEN
    RAISE EXCEPTION 'LINE通知workerの接続roleが不正です';
  END IF;
  IF p_error_code NOT IN ('aborted', 'timeout', 'provider_id_missing') THEN
    RAISE EXCEPTION 'LINE通知の照合待ち理由が不正です';
  END IF;
  WITH changed AS (
    UPDATE line_delivery_outbox AS o
       SET status = 'unknown', last_error_code = p_error_code,
           next_retry_at = NULL, lease_expires_at = NULL,
           provider_checked_at = NULL
     WHERE o.tenant_id = p_tenant_id AND o.id = p_notification_id
       AND status = 'sending'
       AND attempt_token = p_attempt_token
       AND lease_expires_at > clock_timestamp()
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM changed) INTO updated;
  IF updated THEN
    INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (gen_random_uuid(), p_tenant_id, 'line-delivery-worker', 'line_delivery.unknown', 'line_delivery', p_notification_id, jsonb_build_object('status', 'unknown', 'error_code', p_error_code));
    RETURN QUERY SELECT 'unknown'::text;
  ELSE
    -- tokenまたはleaseが古い場合は状態も監査ログも変更しない。
    RETURN QUERY SELECT 'stale'::text;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION app_mark_line_delivery_unknown(uuid, uuid, uuid, varchar) FROM PUBLIC, cocolo_app;
GRANT EXECUTE ON FUNCTION app_mark_line_delivery_unknown(uuid, uuid, uuid, varchar) TO line_delivery_worker;

COMMENT ON FUNCTION app_mark_line_delivery_unknown(uuid, uuid, uuid, varchar) IS '現行attempt tokenかつ有効leaseのtimeout/Abortだけを照合待ちへ遷移させる';
