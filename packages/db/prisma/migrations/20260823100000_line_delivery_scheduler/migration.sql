-- 業務transactionで作成したLINE通知をworkerがclaimし、外部送信とは分離して確定する。
CREATE TABLE line_delivery_outbox (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  actor_user_id varchar(128) NOT NULL,
  source_type varchar(32) NOT NULL,
  source_id varchar(128) NOT NULL,
  destination varchar(128) NOT NULL,
  title varchar(200) NOT NULL,
  body varchar(4000) NOT NULL,
  deep_link varchar(2048) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',
  attempt integer NOT NULL DEFAULT 0,
  attempt_token uuid,
  lease_expires_at timestamptz,
  next_retry_at timestamptz,
  provider_message_id varchar(256),
  last_error_code varchar(32),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (tenant_id, source_type, source_id),
  CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  CHECK (attempt BETWEEN 0 AND 5),
  CHECK (length(trim(destination)) BETWEEN 1 AND 128),
  CHECK (length(trim(title)) BETWEEN 1 AND 200),
  CHECK (length(body) BETWEEN 1 AND 4000),
  CHECK (deep_link ~ '^https://|^http://localhost(:[0-9]+)?/')
);

CREATE INDEX line_delivery_outbox_due_idx
  ON line_delivery_outbox(status, next_retry_at, created_at, id);

ALTER TABLE line_delivery_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_delivery_outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY line_delivery_outbox_select ON line_delivery_outbox
  FOR SELECT USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY line_delivery_outbox_insert ON line_delivery_outbox
  FOR INSERT WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND actor_user_id = current_setting('app.user_id', true)
    AND current_setting('app.role', true) IN ('owner', 'admin')
  );

GRANT USAGE ON SCHEMA public TO cocolo_app;

-- 利用者経路はtenant・実行者・roleをDB内で再確認し、通知本文を監査ログへ複製しない。
CREATE OR REPLACE FUNCTION app_enqueue_line_delivery(
  p_id uuid,
  p_tenant_id uuid,
  p_actor_user_id varchar(128),
  p_source_type varchar(32),
  p_source_id varchar(128),
  p_destination varchar(128),
  p_title varchar(200),
  p_body varchar(4000),
  p_deep_link varchar(2048)
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result_id uuid;
BEGIN
  IF p_id IS NULL
    OR p_tenant_id IS NULL
    OR p_tenant_id <> NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR p_actor_user_id <> current_setting('app.user_id', true)
    OR current_setting('app.role', true) NOT IN ('owner', 'admin')
    OR NOT EXISTS (
      SELECT 1 FROM tenant_memberships
         WHERE tenant_id = p_tenant_id
         AND user_id = p_actor_user_id
         AND status = 'active'
         AND role::text = current_setting('app.role', true)
    ) THEN
    RAISE EXCEPTION 'LINE通知の登録権限がありません';
  END IF;

  INSERT INTO line_delivery_outbox (
    id, tenant_id, actor_user_id, source_type, source_id, destination,
    title, body, deep_link
  ) VALUES (
    p_id, p_tenant_id, p_actor_user_id, p_source_type, p_source_id,
    p_destination, p_title, p_body, p_deep_link
  )
  ON CONFLICT (tenant_id, source_type, source_id)
  DO UPDATE SET id = line_delivery_outbox.id
  RETURNING id INTO result_id;
  RETURN result_id;
END;
$$;

-- worker専用claim。FOR UPDATE SKIP LOCKEDとlease/token更新を同一短時間transactionで確定する。
CREATE OR REPLACE FUNCTION app_claim_line_delivery_outbox(
  p_now timestamptz,
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
  attempt integer,
  attempt_token uuid,
  lease_expires_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH candidate AS (
    SELECT o.id
      FROM line_delivery_outbox o
     WHERE p_now IS NOT NULL
       AND p_max_attempts BETWEEN 1 AND 5
       AND p_lease_ms BETWEEN 1 AND 600000
       AND o.attempt < p_max_attempts
       AND (
         (o.status = 'pending' AND (o.next_retry_at IS NULL OR o.next_retry_at <= p_now))
         OR (o.status = 'failed' AND (o.next_retry_at IS NULL OR o.next_retry_at <= p_now))
         OR (o.status = 'sending' AND o.lease_expires_at <= p_now)
       )
     ORDER BY o.next_retry_at NULLS FIRST, o.created_at, o.id
     LIMIT 1
     FOR UPDATE SKIP LOCKED
  ), updated AS (
    UPDATE line_delivery_outbox o
       SET status = 'sending',
           attempt = o.attempt + 1,
           attempt_token = md5(random()::text || clock_timestamp()::text)::uuid,
           lease_expires_at = p_now + make_interval(secs => p_lease_ms / 1000.0),
           last_error_code = NULL
      FROM candidate
     WHERE o.id = candidate.id
     RETURNING o.*
  )
  SELECT id, tenant_id, destination, title, body, deep_link, attempt,
         attempt_token, lease_expires_at
    FROM updated;
$$;

-- tokenとleaseが一致するworkerだけが送信済みへ遷移できる。0件更新は古いworkerとして扱う。
CREATE OR REPLACE FUNCTION app_mark_line_delivery_sent(
  p_tenant_id uuid,
  p_notification_id uuid,
  p_attempt_token uuid,
  p_provider_message_id varchar(256),
  p_now timestamptz
)
RETURNS TABLE (outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  updated boolean;
BEGIN
  WITH changed AS (
    UPDATE line_delivery_outbox
       SET status = 'sent', provider_message_id = p_provider_message_id,
           sent_at = p_now, lease_expires_at = NULL, next_retry_at = NULL
     WHERE tenant_id = p_tenant_id AND id = p_notification_id
       AND status = 'sending' AND attempt_token = p_attempt_token
       AND lease_expires_at > p_now
       AND p_provider_message_id IS NOT NULL
       AND length(trim(p_provider_message_id)) BETWEEN 1 AND 256
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM changed) INTO updated;
  IF updated THEN
    INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (
      md5(random()::text || clock_timestamp()::text)::uuid, p_tenant_id,
      'line-delivery-worker', 'line_delivery.sent', 'line_delivery',
      p_notification_id, jsonb_build_object('status', 'sent')
    );
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
  p_next_retry_at timestamptz,
  p_now timestamptz
)
RETURNS TABLE (outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  updated boolean;
BEGIN
  IF p_error_code NOT IN ('aborted', 'timeout', 'provider_failure') THEN
    RAISE EXCEPTION 'LINE通知の失敗理由が不正です';
  END IF;
  WITH changed AS (
    UPDATE line_delivery_outbox
       SET status = 'failed', last_error_code = p_error_code,
           next_retry_at = p_next_retry_at, lease_expires_at = NULL
     WHERE tenant_id = p_tenant_id AND id = p_notification_id
       AND status = 'sending' AND attempt_token = p_attempt_token
       AND lease_expires_at > p_now
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM changed) INTO updated;
  IF updated THEN
    INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (
      md5(random()::text || clock_timestamp()::text)::uuid, p_tenant_id,
      'line-delivery-worker', 'line_delivery.failed', 'line_delivery',
      p_notification_id, jsonb_build_object('status', 'failed', 'error_code', p_error_code)
    );
    RETURN QUERY SELECT 'failed'::text;
  ELSE
    RETURN QUERY SELECT 'stale'::text;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION app_enqueue_line_delivery(uuid, uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_claim_line_delivery_outbox(timestamptz, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_mark_line_delivery_sent(uuid, uuid, uuid, varchar, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_mark_line_delivery_failed(uuid, uuid, uuid, varchar, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_enqueue_line_delivery(uuid, uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar) TO cocolo_app;
GRANT EXECUTE ON FUNCTION app_claim_line_delivery_outbox(timestamptz, integer, integer) TO cocolo_app;
GRANT EXECUTE ON FUNCTION app_mark_line_delivery_sent(uuid, uuid, uuid, varchar, timestamptz) TO cocolo_app;
GRANT EXECUTE ON FUNCTION app_mark_line_delivery_failed(uuid, uuid, uuid, varchar, timestamptz, timestamptz) TO cocolo_app;

COMMENT ON TABLE line_delivery_outbox IS 'LINE送信依頼。本文は外部ログへ出さず、送信はclaim transaction外で行う';
COMMENT ON FUNCTION app_claim_line_delivery_outbox(timestamptz, integer, integer) IS '短時間transactionで一件をattempt token付きsendingへclaimする';
COMMENT ON FUNCTION app_mark_line_delivery_sent(uuid, uuid, uuid, varchar, timestamptz) IS '一致するattempt tokenとleaseを持つworkerだけが送信済みへ確定する';
COMMENT ON FUNCTION app_mark_line_delivery_failed(uuid, uuid, uuid, varchar, timestamptz, timestamptz) IS '一致するattempt tokenとleaseを持つworkerだけが再試行状態へ確定する';
