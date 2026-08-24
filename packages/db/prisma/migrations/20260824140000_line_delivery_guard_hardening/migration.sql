-- LINE通知の接続世代・RLS context・冪等再送を同じDB境界で再検証する。
CREATE OR REPLACE FUNCTION app_enqueue_line_delivery(
  p_id uuid,
  p_tenant_id uuid,
  p_actor_user_id varchar(128),
  p_source_type varchar(32),
  p_source_id varchar(128),
  p_destination varchar(128),
  p_title varchar(200),
  p_body varchar(4000),
  p_deep_link varchar(2048),
  p_idempotency_key varchar(128)
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result_id uuid;
  calculated_hash char(64);
  connection_connected_at timestamptz;
BEGIN
  IF session_user <> 'cocolo_app'
    OR p_id IS NULL
    OR p_tenant_id IS NULL
    OR p_idempotency_key IS NULL
    OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR p_tenant_id <> NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR p_actor_user_id IS NULL
    OR NULLIF(current_setting('app.user_id', true), '') IS NULL
    OR p_actor_user_id <> current_setting('app.user_id', true)
    OR NULLIF(current_setting('app.role', true), '') IS NULL
    OR current_setting('app.role', true) NOT IN ('owner', 'admin')
    OR length(trim(p_idempotency_key)) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'LINE通知の登録権限または冪等キーが不正です';
  END IF;

  PERFORM 1
    FROM tenant_memberships
   WHERE tenant_id = p_tenant_id
     AND user_id = p_actor_user_id
     AND status = 'active'
     AND role::text = current_setting('app.role', true)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LINE通知の登録権限がありません';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('line:' || p_tenant_id::text, 0)
  );
  SELECT connected_at INTO connection_connected_at
    FROM line_connections
   WHERE tenant_id = p_tenant_id
     AND group_id = p_destination
     AND status = 'connected'::line_connection_status
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '接続済みのLINEグループ以外へ通知できません';
  END IF;

  calculated_hash := encode(
    digest(concat_ws(E'\x1f', p_destination, p_title, p_body, p_deep_link), 'sha256'),
    'hex'
  );
  INSERT INTO line_delivery_outbox (
    id, tenant_id, actor_user_id, source_type, source_id, destination,
    title, body, deep_link, idempotency_key, payload_hash,
    connection_connected_at
  ) VALUES (
    p_id, p_tenant_id, p_actor_user_id, p_source_type, p_source_id,
    p_destination, p_title, p_body, p_deep_link, trim(p_idempotency_key),
    calculated_hash, connection_connected_at
  )
  ON CONFLICT (tenant_id, source_type, source_id)
  DO UPDATE SET
    destination = CASE
      WHEN line_delivery_outbox.status IN ('pending', 'failed')
      THEN EXCLUDED.destination
      ELSE line_delivery_outbox.destination
    END,
    connection_connected_at = CASE
      WHEN line_delivery_outbox.status IN ('pending', 'failed')
      THEN EXCLUDED.connection_connected_at
      ELSE line_delivery_outbox.connection_connected_at
    END
    WHERE line_delivery_outbox.idempotency_key = EXCLUDED.idempotency_key
      AND line_delivery_outbox.payload_hash = EXCLUDED.payload_hash
  RETURNING id INTO result_id;
  IF result_id IS NULL THEN
    RAISE EXCEPTION 'LINE通知の冪等キーまたはpayloadが既存値と異なります';
  END IF;
  RETURN result_id;
END;
$$;

REVOKE ALL ON FUNCTION app_enqueue_line_delivery(uuid, uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_enqueue_line_delivery(uuid, uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar) TO cocolo_app;

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
   LIMIT 1
   FOR UPDATE OF o SKIP LOCKED;
  IF candidate_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('line:' || candidate_tenant_id::text, 0)
  );
  IF NOT EXISTS (
    SELECT 1
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

REVOKE ALL ON FUNCTION app_claim_line_delivery_outbox(integer, integer) FROM PUBLIC, cocolo_app;
GRANT EXECUTE ON FUNCTION app_claim_line_delivery_outbox(integer, integer) TO line_delivery_worker;
REVOKE ALL ON FUNCTION app_validate_line_delivery_claim(uuid, uuid, uuid) FROM PUBLIC, cocolo_app;
GRANT EXECUTE ON FUNCTION app_validate_line_delivery_claim(uuid, uuid, uuid) TO line_delivery_worker;

COMMENT ON FUNCTION app_claim_line_delivery_outbox(integer, integer) IS 'LINE接続世代が一致する通知だけをclaimする。世代不明の旧通知もtenant自身の接続存在と作成時刻を確認する';
COMMENT ON FUNCTION app_validate_line_delivery_claim(uuid, uuid, uuid) IS '外部送信直前にLINE接続世代を再検証し、古い通知をunknownへ確定する';
