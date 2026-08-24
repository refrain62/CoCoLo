-- 汎用通知の送信中にLINE groupが別tenantへ再利用される競合を防止する。
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
BEGIN
  IF session_user <> 'line_delivery_worker' THEN
    RAISE EXCEPTION 'LINE通知workerの接続roleが不正です';
  END IF;
  IF p_max_attempts NOT BETWEEN 1 AND 5 OR p_lease_ms NOT BETWEEN 1 AND 600000 THEN
    RAISE EXCEPTION 'LINE通知claimの引数が不正です';
  END IF;
  SELECT o.id, o.tenant_id
    INTO candidate_id, candidate_tenant_id
    FROM line_delivery_outbox o
   WHERE o.attempt < p_max_attempts
     AND (
       EXISTS (
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
       OR (
         o.source_type NOT IN ('event', 'deadline')
         AND o.connection_connected_at IS NULL
         AND NOT EXISTS (
           SELECT 1
             FROM line_connections c
            WHERE c.group_id = o.destination
              AND c.status = 'connected'::line_connection_status
              AND c.tenant_id <> o.tenant_id
         )
       )
     )
     AND (
       (o.status IN ('pending', 'failed')
        AND (o.next_retry_at IS NULL OR o.next_retry_at <= db_now))
       OR (o.status = 'sending' AND o.lease_expires_at <= db_now)
     )
   ORDER BY o.next_retry_at NULLS FIRST, o.created_at, o.id
   LIMIT 1
   FOR UPDATE OF o SKIP LOCKED;
  IF candidate_id IS NULL THEN
    RETURN;
  END IF;

  -- LINE接続のconnect/disconnectと同じtenant lockを取得し、世代判定中の変更を直列化する。
  PERFORM pg_advisory_xact_lock(
    hashtextextended('line:' || candidate_tenant_id::text, 0)
  );
  IF NOT EXISTS (
    SELECT 1
      FROM line_delivery_outbox o
     WHERE o.id = candidate_id
       AND o.attempt < p_max_attempts
       AND (
         EXISTS (
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
         OR (
           o.source_type NOT IN ('event', 'deadline')
           AND o.connection_connected_at IS NULL
           AND NOT EXISTS (
             SELECT 1
               FROM line_connections c
              WHERE c.group_id = o.destination
                AND c.status = 'connected'::line_connection_status
                AND c.tenant_id <> o.tenant_id
           )
         )
       )
       AND (
         (o.status IN ('pending', 'failed')
          AND (o.next_retry_at IS NULL OR o.next_retry_at <= db_now))
         OR (o.status = 'sending' AND o.lease_expires_at <= db_now)
       )
  ) THEN
    RETURN;
  END IF;

  UPDATE line_delivery_outbox o
     SET status = 'sending',
         attempt = o.attempt + 1,
         attempt_token = gen_random_uuid(),
         lease_expires_at = db_now + make_interval(secs => p_lease_ms / 1000.0),
         last_error_code = NULL,
         provider_checked_at = NULL
   WHERE o.id = candidate_id;

  RETURN QUERY
  SELECT o.id, o.tenant_id, o.destination, o.title, o.body, o.deep_link,
         o.idempotency_key, o.provider_retry_key, o.payload_hash, o.attempt,
         o.attempt_token, o.lease_expires_at
    FROM line_delivery_outbox o
   WHERE o.id = candidate_id;
END;
$$;

-- claim後、外部送信直前にもgroup再利用と接続世代を再検証する。
CREATE OR REPLACE FUNCTION app_validate_line_delivery_claim(
  p_tenant_id uuid,
  p_notification_id uuid,
  p_attempt_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  is_current boolean;
  invalidated boolean;
  affected_rows integer;
BEGIN
  IF session_user <> 'line_delivery_worker' THEN
    RAISE EXCEPTION 'LINE通知workerの接続roleが不正です';
  END IF;
  SELECT EXISTS (
    SELECT 1
      FROM line_delivery_outbox o
     WHERE o.tenant_id = p_tenant_id
       AND o.id = p_notification_id
       AND o.status = 'sending'
       AND o.attempt_token = p_attempt_token
       AND o.lease_expires_at > clock_timestamp()
       AND (
         EXISTS (
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
         OR (
           o.source_type NOT IN ('event', 'deadline')
           AND o.connection_connected_at IS NULL
           AND NOT EXISTS (
             SELECT 1
               FROM line_connections c
              WHERE c.group_id = o.destination
                AND c.status = 'connected'::line_connection_status
                AND c.tenant_id <> o.tenant_id
           )
         )
       )
  ) INTO is_current;
  IF is_current THEN
    RETURN true;
  END IF;

  UPDATE line_delivery_outbox
     SET status = 'unknown',
         last_error_code = 'connection_changed',
         next_retry_at = NULL,
         lease_expires_at = NULL,
         provider_checked_at = NULL
   WHERE tenant_id = p_tenant_id
     AND id = p_notification_id
     AND status = 'sending'
     AND attempt_token = p_attempt_token;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  invalidated := affected_rows > 0;
  IF invalidated THEN
    INSERT INTO audit_logs (
      id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata
    ) VALUES (
      gen_random_uuid(), p_tenant_id, 'line-delivery-worker',
      'line_delivery.unknown', 'line_delivery', p_notification_id,
      jsonb_build_object('status', 'unknown', 'error_code', 'connection_changed')
    );
  END IF;
  RETURN false;
END;
$$;

COMMENT ON FUNCTION app_claim_line_delivery_outbox(integer, integer) IS '汎用通知を含め、現在のLINE接続世代とgroup所有者に一致する通知だけをclaimする';
COMMENT ON FUNCTION app_validate_line_delivery_claim(uuid, uuid, uuid) IS '外部送信直前にLINE接続世代とgroup所有者を再検証し、古い通知をunknownへ確定する';
