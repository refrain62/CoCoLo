-- 公開通知APIが、tenantの現在のLINE接続先以外へ登録できないようにする。
-- 接続世代もoutboxへ保存し、切断・再接続後の古い通知をworkerがclaimしないようにする。
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

  -- 所属変更と通知登録を直列化する。
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

  -- connect/disconnectと同じtenant lockで接続世代の読み取りを直列化する。
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

REVOKE ALL ON FUNCTION app_enqueue_line_delivery(uuid, uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_enqueue_line_delivery(uuid, uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar) TO cocolo_app;
