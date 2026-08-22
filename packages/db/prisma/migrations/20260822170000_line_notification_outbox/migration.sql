-- 業務transactionと通知依頼を同時に確定し、LINE外部APIの障害を業務保存から分離する。
CREATE TYPE line_notification_outbox_status AS ENUM (
  'pending',
  'delivered',
  'ignored',
  'failed'
);

ALTER TABLE line_notification_queue
  ADD COLUMN outbox_id uuid;

CREATE UNIQUE INDEX line_notification_queue_outbox_id_idx
  ON line_notification_queue(outbox_id)
  WHERE outbox_id IS NOT NULL;

CREATE TABLE line_notification_outbox (
  id uuid PRIMARY KEY DEFAULT app_uuidv7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  actor_user_id varchar(128) NOT NULL,
  source_type line_notification_source NOT NULL,
  source_id varchar(128) NOT NULL,
  title varchar(200) NOT NULL,
  body varchar(4000) NOT NULL,
  deep_link varchar(2048) NOT NULL,
  status line_notification_outbox_status NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  deliver_at timestamptz NOT NULL,
  last_error varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (tenant_id, source_type, source_id),
  CHECK (app_is_uuidv7(id)),
  CHECK (attempts BETWEEN 0 AND 5),
  CHECK (deep_link ~ '^https://|^http://localhost(:[0-9]+)?/')
);

ALTER TABLE line_notification_queue
  ADD CONSTRAINT line_notification_queue_outbox_fk
  FOREIGN KEY (outbox_id) REFERENCES line_notification_outbox(id) ON DELETE RESTRICT;

CREATE INDEX line_notification_outbox_due_idx
  ON line_notification_outbox(status, deliver_at, created_at, id);

ALTER TABLE line_notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_notification_outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY line_outbox_insert ON line_notification_outbox FOR INSERT
  WITH CHECK (
    app_has_active_membership(tenant_id)
    AND actor_user_id = current_setting('app.user_id', true)
  );

CREATE POLICY line_outbox_update ON line_notification_outbox FOR UPDATE
  USING (
    app_has_active_membership(tenant_id)
    AND app_is_event_manager()
  )
  WITH CHECK (
    app_has_active_membership(tenant_id)
    AND app_is_event_manager()
    AND actor_user_id = current_setting('app.user_id', true)
  );

GRANT USAGE ON TYPE line_notification_outbox_status TO cocolo_app;

-- APIは表へ直接upsertせず、この関数で所属・実行者を再確認してから依頼を記録する。
CREATE OR REPLACE FUNCTION app_enqueue_line_notification_outbox(
  p_tenant_id uuid,
  p_actor_user_id varchar(128),
  p_source_type line_notification_source,
  p_source_id varchar(128),
  p_title varchar(200),
  p_body varchar(4000),
  p_deep_link varchar(2048),
  p_deliver_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_tenant_id IS NULL
    OR NOT app_has_active_membership(p_tenant_id)
    OR p_actor_user_id <> current_setting('app.user_id', true)
    OR NOT app_is_event_manager() THEN
    RAISE EXCEPTION 'LINE通知outboxの登録権限がありません';
  END IF;

  INSERT INTO line_notification_outbox (
    tenant_id,
    actor_user_id,
    source_type,
    source_id,
    title,
    body,
    deep_link,
    deliver_at
  ) VALUES (
    p_tenant_id,
    p_actor_user_id,
    p_source_type,
    p_source_id,
    p_title,
    p_body,
    p_deep_link,
    p_deliver_at
  )
  ON CONFLICT (tenant_id, source_type, source_id)
  DO UPDATE SET
    actor_user_id = EXCLUDED.actor_user_id,
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    deep_link = EXCLUDED.deep_link,
    deliver_at = EXCLUDED.deliver_at
  WHERE line_notification_outbox.status = 'pending'::line_notification_outbox_status;
END;
$$;

REVOKE ALL ON FUNCTION app_enqueue_line_notification_outbox(
  uuid, varchar, line_notification_source, varchar, varchar, varchar, varchar, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_enqueue_line_notification_outbox(
  uuid, varchar, line_notification_source, varchar, varchar, varchar, varchar, timestamptz
) TO cocolo_app;

-- workerは一件ずつoutboxをqueueへ移す。未接続tenantは成功扱いにせずignoredとして確定する。
CREATE OR REPLACE FUNCTION app_process_line_notification_outbox(
  p_now timestamptz,
  p_max_attempts integer
)
RETURNS TABLE (outcome text, outbox_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  selected_outbox line_notification_outbox%ROWTYPE;
  connected_group varchar(128);
BEGIN
  IF p_now IS NULL OR p_max_attempts NOT BETWEEN 1 AND 5 THEN
    RETURN QUERY SELECT 'idle'::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT *
    INTO selected_outbox
    FROM line_notification_outbox
   WHERE status = 'pending'::line_notification_outbox_status
     AND attempts < p_max_attempts
     AND deliver_at <= p_now
   ORDER BY deliver_at, created_at, id
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'idle'::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT group_id
    INTO connected_group
    FROM line_connections
   WHERE tenant_id = selected_outbox.tenant_id
     AND status = 'connected'::line_connection_status
     AND group_id IS NOT NULL
   LIMIT 1;

  IF connected_group IS NULL THEN
    UPDATE line_notification_outbox
       SET status = 'ignored'::line_notification_outbox_status,
           attempts = attempts + 1,
           processed_at = p_now
     WHERE id = selected_outbox.id;
    RETURN QUERY SELECT 'ignored'::text, selected_outbox.id;
    RETURN;
  END IF;

  INSERT INTO line_notification_queue (
    outbox_id,
    tenant_id,
    group_id,
    created_by_user_id,
    source_type,
    source_id,
    title,
    body,
    deep_link,
    status,
    attempts,
    created_at
  ) VALUES (
    selected_outbox.id,
    selected_outbox.tenant_id,
    connected_group,
    selected_outbox.actor_user_id,
    selected_outbox.source_type,
    selected_outbox.source_id,
    selected_outbox.title,
    selected_outbox.body,
    selected_outbox.deep_link,
    'pending'::line_notification_status,
    0,
    p_now
  ) ON CONFLICT (outbox_id) DO NOTHING;

  UPDATE line_notification_outbox
     SET status = 'delivered'::line_notification_outbox_status,
         attempts = attempts + 1,
         processed_at = p_now,
         last_error = NULL
   WHERE id = selected_outbox.id;

  RETURN QUERY SELECT 'queued'::text, selected_outbox.id;
END;
$$;

REVOKE ALL ON FUNCTION app_process_line_notification_outbox(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_process_line_notification_outbox(timestamptz, integer) TO cocolo_app;

COMMENT ON TABLE line_notification_outbox
  IS '予定・締切・回覧の保存transactionからLINE送信依頼を受け取るoutbox';
COMMENT ON FUNCTION app_enqueue_line_notification_outbox(
  uuid, varchar, line_notification_source, varchar, varchar, varchar, varchar, timestamptz
)
  IS '所属と実行者を再確認してLINE通知outboxを冪等登録する';
COMMENT ON FUNCTION app_process_line_notification_outbox(timestamptz, integer)
  IS 'due outboxを接続済みgroupのLINE queueへ一件移す。未接続はignoredにする';
