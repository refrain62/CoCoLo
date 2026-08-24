-- worker claimもtenant lockを先に取得し、管理者再試行とロック順序を統一する。
CREATE OR REPLACE FUNCTION app_claim_line_delivery_outbox(
  p_max_attempts integer,
  p_lease_ms integer
)
RETURNS TABLE (
  notification_id uuid,
  tenant_id uuid,
  destination varchar(128),
  title varchar(200),
  body varchar(4000),
  deep_link varchar(2048),
  idempotency_key varchar(128),
  provider_retry_key uuid,
  payload_hash char(64),
  attempt integer,
  attempt_token uuid,
  lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  db_now timestamptz := clock_timestamp();
  candidate_id uuid;
  candidate_tenant_id uuid;
  locked_candidate_id uuid;
BEGIN
  IF session_user <> 'line_delivery_worker' THEN
    RAISE EXCEPTION 'LINE通知workerの接続roleが不正です';
  END IF;
  IF p_max_attempts NOT BETWEEN 1 AND 5 OR p_lease_ms NOT BETWEEN 1 AND 600000 THEN
    RAISE EXCEPTION 'LINE通知claimの引数が不正です';
  END IF;

  -- 候補選択では行をロックせず、tenant advisory lockを先に取得する。
  SELECT o.id, o.tenant_id
    INTO candidate_id, candidate_tenant_id
    FROM line_delivery_outbox o
   WHERE o.attempt < p_max_attempts
     AND EXISTS (
       SELECT 1
         FROM line_connections c
        WHERE c.tenant_id = o.tenant_id
          AND c.group_id = o.destination
          AND c.status = 'connected'::line_connection_status
          AND (
            (o.connection_connected_at IS NOT NULL
             AND c.connected_at = o.connection_connected_at)
            OR (o.connection_connected_at IS NULL
                AND c.connected_at <= o.created_at)
          )
     )
     AND (
       (o.status IN ('pending', 'failed')
        AND (o.next_retry_at IS NULL OR o.next_retry_at <= db_now))
       OR (o.status = 'sending' AND o.lease_expires_at <= db_now)
     )
   ORDER BY o.next_retry_at NULLS FIRST, o.created_at, o.id
   LIMIT 1;
  IF candidate_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('line:' || candidate_tenant_id::text, 0)
  );

  -- advisory lock取得後に再評価して行をロックする。競合中の行は待たずに捨てる。
  SELECT o.id
    INTO locked_candidate_id
    FROM line_delivery_outbox o
   WHERE o.id = candidate_id
     AND o.attempt < p_max_attempts
     AND EXISTS (
       SELECT 1
         FROM line_connections c
        WHERE c.tenant_id = o.tenant_id
          AND c.group_id = o.destination
          AND c.status = 'connected'::line_connection_status
          AND (
            (o.connection_connected_at IS NOT NULL
             AND c.connected_at = o.connection_connected_at)
            OR (o.connection_connected_at IS NULL
                AND c.connected_at <= o.created_at)
          )
     )
     AND (
       (o.status IN ('pending', 'failed')
        AND (o.next_retry_at IS NULL OR o.next_retry_at <= db_now))
       OR (o.status = 'sending' AND o.lease_expires_at <= db_now)
     )
   FOR UPDATE OF o SKIP LOCKED;
  IF locked_candidate_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE line_delivery_outbox o
     SET status = 'sending',
         attempt = o.attempt + 1,
         attempt_token = gen_random_uuid(),
         lease_expires_at = db_now + make_interval(secs => p_lease_ms / 1000.0),
         last_error_code = NULL,
         provider_checked_at = NULL
   WHERE o.id = locked_candidate_id;

  RETURN QUERY
  SELECT o.id, o.tenant_id, o.destination, o.title, o.body, o.deep_link,
         o.idempotency_key, o.provider_retry_key, o.payload_hash, o.attempt,
         o.attempt_token, o.lease_expires_at
    FROM line_delivery_outbox o
   WHERE o.id = locked_candidate_id;
END;
$$;

REVOKE ALL ON FUNCTION app_claim_line_delivery_outbox(integer, integer) FROM PUBLIC, cocolo_app;
GRANT EXECUTE ON FUNCTION app_claim_line_delivery_outbox(integer, integer) TO line_delivery_worker;

COMMENT ON FUNCTION app_claim_line_delivery_outbox(integer, integer) IS 'tenant advisory lockを先に取得してからLINE通知outbox行をclaimする';
