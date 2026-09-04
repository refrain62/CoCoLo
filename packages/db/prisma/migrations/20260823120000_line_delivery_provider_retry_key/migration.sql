-- LINEの正式な再送キーは通知行に固定し、lease再取得でも同じ値を送る。
ALTER TABLE line_delivery_outbox
  ADD COLUMN provider_retry_key uuid;

UPDATE line_delivery_outbox
   SET provider_retry_key = gen_random_uuid()
 WHERE provider_retry_key IS NULL;

ALTER TABLE line_delivery_outbox
  ALTER COLUMN provider_retry_key SET DEFAULT gen_random_uuid(),
  ALTER COLUMN provider_retry_key SET NOT NULL;

COMMENT ON COLUMN line_delivery_outbox.provider_retry_key IS '同一payloadの再送に使うX-Line-Retry-Key。通知行の存続期間中は変更しない';

-- 既存の冪等キーとpayload hashが一致した再登録では、最初のprovider retry keyを返し続ける。
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
BEGIN
  IF session_user <> 'cocolo_app' THEN
    RAISE EXCEPTION 'LINE通知の登録経路が不正です';
  END IF;
  IF p_id IS NULL OR p_tenant_id IS NULL OR p_idempotency_key IS NULL
    OR p_tenant_id <> NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR p_actor_user_id <> current_setting('app.user_id', true)
    OR current_setting('app.role', true) NOT IN ('owner', 'admin')
    OR length(trim(p_idempotency_key)) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'LINE通知の登録権限または冪等キーが不正です';
  END IF;

  -- 所属変更と同じ行をロックし、active確認とenqueueの直列化点をそろえる。
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

  calculated_hash := encode(
    digest(concat_ws(E'\x1f', p_destination, p_title, p_body, p_deep_link), 'sha256'),
    'hex'
  );
  INSERT INTO line_delivery_outbox (
    id, tenant_id, actor_user_id, source_type, source_id, destination,
    title, body, deep_link, idempotency_key, payload_hash, provider_retry_key
  ) VALUES (
    p_id, p_tenant_id, p_actor_user_id, p_source_type, p_source_id,
    p_destination, p_title, p_body, p_deep_link, trim(p_idempotency_key),
    calculated_hash, p_id
  )
  ON CONFLICT (tenant_id, source_type, source_id)
  DO UPDATE SET id = line_delivery_outbox.id
    WHERE line_delivery_outbox.idempotency_key = EXCLUDED.idempotency_key
      AND line_delivery_outbox.payload_hash = EXCLUDED.payload_hash
  RETURNING id INTO result_id;
  IF result_id IS NULL THEN
    RAISE EXCEPTION 'LINE通知の冪等キーまたはpayloadが既存値と異なります';
  END IF;
  RETURN result_id;
END;
$$;

DROP FUNCTION app_claim_line_delivery_outbox(integer, integer);

-- claim再取得、provider再送、送信済み確定に同じretry keyを引き渡す。
CREATE FUNCTION app_claim_line_delivery_outbox(
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
BEGIN
  IF session_user <> 'line_delivery_worker' THEN
    RAISE EXCEPTION 'LINE通知workerの接続roleが不正です';
  END IF;
  IF p_max_attempts NOT BETWEEN 1 AND 5 OR p_lease_ms NOT BETWEEN 1 AND 600000 THEN
    RAISE EXCEPTION 'LINE通知claimの引数が不正です';
  END IF;
  RETURN QUERY
  WITH candidate AS (
    SELECT o.id
      FROM line_delivery_outbox o
     WHERE o.attempt < p_max_attempts
       AND (
         (o.status IN ('pending', 'failed') AND (o.next_retry_at IS NULL OR o.next_retry_at <= db_now))
         OR (o.status = 'sending' AND o.lease_expires_at <= db_now)
       )
     ORDER BY o.next_retry_at NULLS FIRST, o.created_at, o.id
     LIMIT 1
     FOR UPDATE SKIP LOCKED
  ), updated AS (
    UPDATE line_delivery_outbox o
       SET status = 'sending',
           attempt = o.attempt + 1,
           attempt_token = gen_random_uuid(),
           lease_expires_at = db_now + make_interval(secs => p_lease_ms / 1000.0),
           last_error_code = NULL,
           provider_checked_at = NULL
      FROM candidate
     WHERE o.id = candidate.id
     RETURNING o.*
  )
  SELECT updated.id, updated.tenant_id, updated.destination, updated.title,
         updated.body, updated.deep_link, updated.idempotency_key,
         updated.provider_retry_key, updated.payload_hash, updated.attempt,
         updated.attempt_token, updated.lease_expires_at
    FROM updated;
END;
$$;

REVOKE ALL ON FUNCTION app_claim_line_delivery_outbox(integer, integer) FROM PUBLIC, cocolo_app;
GRANT EXECUTE ON FUNCTION app_claim_line_delivery_outbox(integer, integer) TO line_delivery_worker;

COMMENT ON FUNCTION app_claim_line_delivery_outbox(integer, integer) IS '短時間transactionでprovider retry key付き通知をclaimする';
