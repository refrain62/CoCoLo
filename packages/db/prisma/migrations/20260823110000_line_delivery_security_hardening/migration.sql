-- 外部送信の不確実性、payloadの同一性、worker権限をDBで固定する。
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE line_delivery_outbox
  ADD COLUMN idempotency_key varchar(128),
  ADD COLUMN payload_hash char(64),
  ADD COLUMN provider_checked_at timestamptz;

UPDATE line_delivery_outbox
   SET idempotency_key = 'line-delivery-' || id::text,
       payload_hash = encode(
         digest(
           concat_ws(E'\x1f', destination, title, body, deep_link),
           'sha256'
         ),
         'hex'
       )
 WHERE idempotency_key IS NULL OR payload_hash IS NULL;

ALTER TABLE line_delivery_outbox
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN payload_hash SET NOT NULL;

ALTER TABLE line_delivery_outbox
  DROP CONSTRAINT line_delivery_outbox_status_check,
  ADD CONSTRAINT line_delivery_outbox_status_check
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'unknown')),
  ADD CONSTRAINT line_delivery_outbox_retry_time_check
    CHECK (next_retry_at IS NULL OR next_retry_at >= created_at),
  ADD CONSTRAINT line_delivery_outbox_payload_hash_check
    CHECK (payload_hash ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX line_delivery_outbox_idempotency_idx
  ON line_delivery_outbox(tenant_id, idempotency_key);

DROP FUNCTION app_enqueue_line_delivery(uuid, uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar);
DROP FUNCTION app_claim_line_delivery_outbox(timestamptz, integer, integer);
DROP FUNCTION app_mark_line_delivery_sent(uuid, uuid, uuid, varchar, timestamptz);
DROP FUNCTION app_mark_line_delivery_failed(uuid, uuid, uuid, varchar, timestamptz, timestamptz);

-- 業務transactionのmembership行を先にロックし、所属変更との直列化点を明示する。
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

  -- membership更新側もこの行をロックする契約とし、active確認と業務更新を同じ直列順にする。
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
    title, body, deep_link, idempotency_key, payload_hash
  ) VALUES (
    p_id, p_tenant_id, p_actor_user_id, p_source_type, p_source_id,
    p_destination, p_title, p_body, p_deep_link, trim(p_idempotency_key),
    calculated_hash
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

-- claimはDB時刻を使い、アプリの時計ずれでleaseが短くならないようにする。
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
         updated.payload_hash, updated.attempt, updated.attempt_token,
         updated.lease_expires_at
    FROM updated;
END;
$$;

CREATE OR REPLACE FUNCTION app_mark_line_delivery_sent(
  p_tenant_id uuid,
  p_notification_id uuid,
  p_attempt_token uuid,
  p_provider_message_id varchar(256)
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
  WITH changed AS (
    UPDATE line_delivery_outbox AS o
       SET status = 'sent', provider_message_id = trim(p_provider_message_id),
           sent_at = clock_timestamp(), lease_expires_at = NULL,
           next_retry_at = NULL, provider_checked_at = clock_timestamp()
     WHERE o.tenant_id = p_tenant_id AND o.id = p_notification_id
       AND status = 'sending' AND attempt_token = p_attempt_token
       AND lease_expires_at > clock_timestamp()
       AND p_provider_message_id IS NOT NULL
       AND length(trim(p_provider_message_id)) BETWEEN 1 AND 256
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM changed) INTO updated;
  IF updated THEN
    INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (gen_random_uuid(), p_tenant_id, 'line-delivery-worker', 'line_delivery.sent', 'line_delivery', p_notification_id, jsonb_build_object('status', 'sent'));
    RETURN QUERY SELECT 'sent'::text;
  ELSE
    RETURN QUERY SELECT 'stale'::text;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_mark_line_delivery_failed(
  p_tenant_id uuid,
  p_notification_id uuid,
  p_attempt_token uuid,
  p_error_code varchar(32),
  p_retry_delay_ms integer
)
RETURNS TABLE (outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  updated boolean;
  db_now timestamptz := clock_timestamp();
  retry_at timestamptz;
BEGIN
  IF session_user <> 'line_delivery_worker' THEN
    RAISE EXCEPTION 'LINE通知workerの接続roleが不正です';
  END IF;
  IF p_error_code NOT IN ('provider_failure') OR p_retry_delay_ms NOT BETWEEN 0 AND 3600000 THEN
    RAISE EXCEPTION 'LINE通知の失敗理由または再試行時刻が不正です';
  END IF;
  retry_at := db_now + make_interval(secs => p_retry_delay_ms / 1000.0);
  WITH changed AS (
    UPDATE line_delivery_outbox AS o
       SET status = 'failed', last_error_code = p_error_code,
           next_retry_at = retry_at, lease_expires_at = NULL
     WHERE o.tenant_id = p_tenant_id AND o.id = p_notification_id
       AND status = 'sending' AND attempt_token = p_attempt_token
       AND lease_expires_at > db_now
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM changed) INTO updated;
  IF updated THEN
    INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (gen_random_uuid(), p_tenant_id, 'line-delivery-worker', 'line_delivery.failed', 'line_delivery', p_notification_id, jsonb_build_object('status', 'failed', 'error_code', p_error_code));
    RETURN QUERY SELECT 'failed'::text;
  ELSE
    RETURN QUERY SELECT 'stale'::text;
  END IF;
END;
$$;

-- timeout/Abortやprovider ID欠落は外部副作用の有無を確定できないため再送対象から外す。
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
       AND status = 'sending' AND attempt_token = p_attempt_token
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM changed) INTO updated;
  IF updated THEN
    INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (gen_random_uuid(), p_tenant_id, 'line-delivery-worker', 'line_delivery.unknown', 'line_delivery', p_notification_id, jsonb_build_object('status', 'unknown', 'error_code', p_error_code));
    RETURN QUERY SELECT 'unknown'::text;
  ELSE
    RETURN QUERY SELECT 'stale'::text;
  END IF;
END;
$$;

REVOKE ALL ON TABLE line_delivery_outbox FROM cocolo_app;
REVOKE ALL ON FUNCTION app_enqueue_line_delivery(uuid, uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_claim_line_delivery_outbox(integer, integer) FROM PUBLIC, cocolo_app;
REVOKE ALL ON FUNCTION app_mark_line_delivery_sent(uuid, uuid, uuid, varchar) FROM PUBLIC, cocolo_app;
REVOKE ALL ON FUNCTION app_mark_line_delivery_failed(uuid, uuid, uuid, varchar, integer) FROM PUBLIC, cocolo_app;
REVOKE ALL ON FUNCTION app_mark_line_delivery_unknown(uuid, uuid, uuid, varchar) FROM PUBLIC, cocolo_app;
GRANT EXECUTE ON FUNCTION app_enqueue_line_delivery(uuid, uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar) TO cocolo_app;
GRANT USAGE ON SCHEMA public TO line_delivery_worker;
GRANT EXECUTE ON FUNCTION app_claim_line_delivery_outbox(integer, integer) TO line_delivery_worker;
GRANT EXECUTE ON FUNCTION app_mark_line_delivery_sent(uuid, uuid, uuid, varchar) TO line_delivery_worker;
GRANT EXECUTE ON FUNCTION app_mark_line_delivery_failed(uuid, uuid, uuid, varchar, integer) TO line_delivery_worker;
GRANT EXECUTE ON FUNCTION app_mark_line_delivery_unknown(uuid, uuid, uuid, varchar) TO line_delivery_worker;

COMMENT ON COLUMN line_delivery_outbox.idempotency_key IS 'providerへ渡す通知単位の再送防止キー';
COMMENT ON COLUMN line_delivery_outbox.payload_hash IS '外部送信payloadのSHA-256。冪等再登録時に同一内容を保証する';
COMMENT ON COLUMN line_delivery_outbox.provider_checked_at IS 'unknown状態をprovider照合した時刻';
COMMENT ON FUNCTION app_mark_line_delivery_unknown(uuid, uuid, uuid, varchar) IS '外部副作用を取り消せないtimeout/Abortを照合待ちへ遷移させる';
