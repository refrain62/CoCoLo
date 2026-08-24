-- 予定の業務transactionからLINE outboxへ登録する専用関数を追加する。
-- 手動通知APIのowner/admin制約とは分離し、予定を管理できるstaffも利用できるようにする。
ALTER TABLE line_delivery_outbox
  ADD COLUMN connection_connected_at timestamptz;

COMMENT ON COLUMN line_delivery_outbox.connection_connected_at IS '通知登録時に紐付けたLINE接続世代。切断・再接続後の古い通知をclaimしない';

CREATE OR REPLACE FUNCTION app_enqueue_event_line_delivery(
  p_id uuid,
  p_tenant_id uuid,
  p_actor_user_id varchar(128),
  p_source_type varchar(32),
  p_source_id varchar(128),
  p_destination varchar(128),
  p_title varchar(200),
  p_body varchar(4000),
  p_deep_link varchar(2048),
  p_idempotency_key varchar(128),
  p_deliver_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result_id uuid;
  normalized_source_id varchar(128);
  connection_connected_at timestamptz;
  calculated_hash char(64);
  db_now timestamptz := clock_timestamp();
BEGIN
  IF session_user <> 'cocolo_app'
    OR p_id IS NULL
    OR p_tenant_id IS NULL
    OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR p_tenant_id <> NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR p_actor_user_id IS NULL
    OR NULLIF(current_setting('app.user_id', true), '') IS NULL
    OR p_actor_user_id <> current_setting('app.user_id', true)
    OR NULLIF(current_setting('app.role', true), '') IS NULL
    OR current_setting('app.role', true) NOT IN ('owner', 'admin', 'staff')
    OR p_source_type IS NULL
    OR p_source_type NOT IN ('event', 'deadline')
    OR p_source_id IS NULL
    OR length(trim(p_source_id)) NOT BETWEEN 1 AND 128
    OR p_source_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_destination IS NULL
    OR length(trim(p_destination)) NOT BETWEEN 1 AND 128
    OR p_title IS NULL
    OR length(trim(p_title)) NOT BETWEEN 1 AND 200
    OR p_body IS NULL
    OR length(p_body) NOT BETWEEN 1 AND 4000
    OR p_deep_link IS NULL
    OR p_idempotency_key IS NULL
    OR length(trim(p_idempotency_key)) NOT BETWEEN 1 AND 128
    OR p_deliver_at IS NULL THEN
    RAISE EXCEPTION '予定LINE通知の登録権限または入力値が不正です';
  END IF;

  normalized_source_id := p_source_id::uuid::text;
  IF p_idempotency_key <> p_source_type || ':' || normalized_source_id THEN
    RAISE EXCEPTION '予定LINE通知の登録権限または入力値が不正です';
  END IF;

  IF (p_source_type = 'event' AND (
        p_title <> '予定のお知らせ'
        OR p_body <> '予定の詳細を確認してください。'
      ))
    OR (p_source_type = 'deadline' AND (
        p_title <> '出欠締切のお知らせ'
        OR p_body <> '出欠締切が近づいています。予定の詳細を確認してください。'
      ))
    OR p_deep_link !~ ('^(https://[^/]+|http://localhost(:[0-9]+)?)/events/' || normalized_source_id || '$') THEN
    RAISE EXCEPTION '予定LINE通知の本文またはリンクが不正です';
  END IF;

  -- event repositoryのadvisory lockと同じキーで直列化し、lock upgradeを起こさない。
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':' || p_actor_user_id, 0)
  );
  PERFORM 1
    FROM tenant_memberships
   WHERE tenant_id = p_tenant_id
     AND user_id = p_actor_user_id
     AND status = 'active'
     AND role::text = current_setting('app.role', true)
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '予定LINE通知の登録権限がありません';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM events
     WHERE tenant_id = p_tenant_id
       AND id = normalized_source_id::uuid
  ) THEN
    RAISE EXCEPTION '予定LINE通知の対象予定がありません';
  END IF;

  SELECT connected_at INTO connection_connected_at
    FROM line_connections
   WHERE tenant_id = p_tenant_id
     AND group_id = p_destination
     AND status = 'connected'::line_connection_status
   FOR KEY SHARE;
  IF NOT FOUND THEN
    -- 接続変更と予定保存が競合した場合は、予定保存をrollbackせず通知だけ省略する。
    RETURN NULL;
  END IF;

  calculated_hash := encode(
    digest(concat_ws(E'\x1f', p_destination, p_title, p_body, p_deep_link), 'sha256'),
    'hex'
  );
  INSERT INTO line_delivery_outbox (
    id, tenant_id, actor_user_id, source_type, source_id, destination,
    title, body, deep_link, idempotency_key, payload_hash, next_retry_at,
    connection_connected_at
  ) VALUES (
    p_id, p_tenant_id, p_actor_user_id, p_source_type, normalized_source_id,
    p_destination, p_title, p_body, trim(p_idempotency_key), calculated_hash,
    CASE WHEN p_deliver_at <= db_now THEN NULL ELSE p_deliver_at END,
    connection_connected_at
  )
  ON CONFLICT (tenant_id, source_type, source_id)
  DO UPDATE SET
    destination = CASE
      WHEN line_delivery_outbox.status IN ('pending', 'failed')
      THEN EXCLUDED.destination
      ELSE line_delivery_outbox.destination
    END,
    title = CASE
      WHEN line_delivery_outbox.status IN ('pending', 'failed')
      THEN EXCLUDED.title
      ELSE line_delivery_outbox.title
    END,
    body = CASE
      WHEN line_delivery_outbox.status IN ('pending', 'failed')
      THEN EXCLUDED.body
      ELSE line_delivery_outbox.body
    END,
    deep_link = CASE
      WHEN line_delivery_outbox.status IN ('pending', 'failed')
      THEN EXCLUDED.deep_link
      ELSE line_delivery_outbox.deep_link
    END,
    payload_hash = CASE
      WHEN line_delivery_outbox.status IN ('pending', 'failed')
      THEN EXCLUDED.payload_hash
      ELSE line_delivery_outbox.payload_hash
    END,
    provider_retry_key = CASE
      WHEN line_delivery_outbox.status IN ('pending', 'failed')
       AND line_delivery_outbox.payload_hash <> EXCLUDED.payload_hash
      THEN gen_random_uuid()
      ELSE line_delivery_outbox.provider_retry_key
    END,
    status = CASE
      WHEN line_delivery_outbox.status = 'failed'
       AND line_delivery_outbox.payload_hash <> EXCLUDED.payload_hash
      THEN 'pending'
      ELSE line_delivery_outbox.status
    END,
    last_error_code = CASE
      WHEN line_delivery_outbox.status IN ('pending', 'failed')
      THEN NULL
      ELSE line_delivery_outbox.last_error_code
    END,
    next_retry_at = CASE
      WHEN line_delivery_outbox.status IN ('pending', 'failed')
      THEN EXCLUDED.next_retry_at
      ELSE line_delivery_outbox.next_retry_at
    END,
    connection_connected_at = CASE
      WHEN line_delivery_outbox.status IN ('pending', 'failed')
      THEN EXCLUDED.connection_connected_at
      ELSE line_delivery_outbox.connection_connected_at
    END
    WHERE line_delivery_outbox.idempotency_key = EXCLUDED.idempotency_key
  RETURNING id INTO result_id;
  IF result_id IS NULL THEN
    RAISE EXCEPTION '予定LINE通知の冪等キーまたはpayloadが既存値と異なります';
  END IF;
  RETURN result_id;
END;
$$;

REVOKE ALL ON FUNCTION app_enqueue_event_line_delivery(uuid, uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar, timestamptz) FROM PUBLIC, cocolo_app;
GRANT EXECUTE ON FUNCTION app_enqueue_event_line_delivery(uuid, uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar, timestamptz) TO cocolo_app;
COMMENT ON FUNCTION app_enqueue_event_line_delivery(uuid, uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar, timestamptz) IS '予定の保存transactionから即時または締切前のLINE通知を冪等登録する';
