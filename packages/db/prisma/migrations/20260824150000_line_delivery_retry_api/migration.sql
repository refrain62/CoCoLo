-- owner/adminの再試行も現行line_delivery_outboxと接続世代検証を通す。
CREATE OR REPLACE FUNCTION app_retry_line_delivery_outbox(
  p_tenant_id uuid,
  p_actor_user_id varchar(128),
  p_notification_id uuid
)
RETURNS TABLE (
  notification_id uuid,
  status varchar(16)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  notification_destination varchar(128);
  notification_status varchar(16);
  notification_attempt integer;
  notification_created_at timestamptz;
  notification_connection_at timestamptz;
  current_connection_at timestamptz;
  affected_rows integer;
  changed boolean;
BEGIN
  IF session_user <> 'cocolo_app'
    OR p_tenant_id IS NULL
    OR p_actor_user_id IS NULL
    OR p_notification_id IS NULL
    OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR p_tenant_id <> NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.user_id', true), '') IS NULL
    OR p_actor_user_id <> current_setting('app.user_id', true)
    OR NULLIF(current_setting('app.role', true), '') IS NULL
    OR NULLIF(current_setting('app.role', true), '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'LINE通知の再試行権限が不正です';
  END IF;

  PERFORM 1
    FROM tenant_memberships
   WHERE tenant_id = p_tenant_id
     AND user_id = p_actor_user_id
     AND status = 'active'
     AND role::text = current_setting('app.role', true)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LINE通知の再試行権限がありません';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('line:' || p_tenant_id::text, 0)
  );

  SELECT o.destination, o.status, o.attempt, o.created_at,
         o.connection_connected_at
    INTO notification_destination, notification_status, notification_attempt,
         notification_created_at, notification_connection_at
    FROM line_delivery_outbox o
   WHERE o.tenant_id = p_tenant_id
     AND o.id = p_notification_id
   FOR UPDATE;
  IF NOT FOUND
    OR notification_status <> 'failed'
    OR notification_attempt >= 5 THEN
    RAISE EXCEPTION 'LINE通知を再試行できません';
  END IF;

  SELECT c.connected_at INTO current_connection_at
    FROM line_connections c
   WHERE c.tenant_id = p_tenant_id
     AND c.group_id = notification_destination
     AND c.status = 'connected'::line_connection_status
   FOR KEY SHARE;
  IF NOT FOUND
    OR (
      notification_connection_at IS NOT NULL
      AND current_connection_at IS DISTINCT FROM notification_connection_at
    )
    OR (
      notification_connection_at IS NULL
      AND current_connection_at > notification_created_at
    ) THEN
    RAISE EXCEPTION '接続済みのLINEグループ以外へ再試行できません';
  END IF;

  UPDATE line_delivery_outbox
     SET status = 'pending',
         next_retry_at = clock_timestamp(),
         lease_expires_at = NULL,
         last_error_code = NULL,
         provider_checked_at = NULL
   WHERE tenant_id = p_tenant_id
     AND id = p_notification_id
     AND status = 'failed'
     AND attempt < 5;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  changed := affected_rows > 0;
  IF NOT changed THEN
    RAISE EXCEPTION 'LINE通知を再試行できません';
  END IF;

  INSERT INTO audit_logs (
    id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata
  ) VALUES (
    app_uuidv7(), p_tenant_id, p_actor_user_id,
    'line_delivery.retry_requested', 'line_delivery', p_notification_id,
    jsonb_build_object('status', 'pending', 'attempt', notification_attempt)
  );

  RETURN QUERY SELECT p_notification_id, 'pending'::varchar(16);
END;
$$;

REVOKE ALL ON FUNCTION app_retry_line_delivery_outbox(uuid, varchar, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_retry_line_delivery_outbox(uuid, varchar, uuid) TO cocolo_app;

COMMENT ON FUNCTION app_retry_line_delivery_outbox(uuid, varchar, uuid) IS
  'owner/adminが現行接続世代のfailed通知だけをpendingへ戻す';
