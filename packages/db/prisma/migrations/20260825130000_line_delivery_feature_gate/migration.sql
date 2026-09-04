-- LINE通知の送信経路でも、APIと同じチーム単位の有効機能判定を使う。
CREATE OR REPLACE FUNCTION app_line_delivery_source_valid(
  p_tenant_id uuid,
  p_source_type varchar,
  p_source_id varchar,
  p_deep_link varchar
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH normalized AS (
    SELECT CASE
      WHEN p_source_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN p_source_id::uuid
      ELSE NULL::uuid
    END AS source_uuid
  )
  SELECT n.source_uuid IS NOT NULL
    AND app_is_uuidv7(n.source_uuid)
    AND (
      (
        p_source_type = 'bulletin'
        AND p_deep_link ~ (
          '^(https://[^/]+|http://localhost(:[0-9]+)?)/bulletins/'
          || n.source_uuid::text || '$'
        )
        AND EXISTS (
          SELECT 1
            FROM announcements a
           WHERE a.tenant_id = p_tenant_id
             AND a.id = n.source_uuid
             AND a.status = 'published'::announcement_status
        )
      )
      OR (
        p_source_type IN ('event', 'deadline')
        AND p_deep_link ~ (
          '^(https://[^/]+|http://localhost(:[0-9]+)?)/events/'
          || n.source_uuid::text || '$'
        )
        AND EXISTS (
          SELECT 1
            FROM events e
           WHERE e.tenant_id = p_tenant_id
             AND e.id = n.source_uuid
        )
      )
    )
  FROM normalized n;
$$;

REVOKE ALL ON FUNCTION app_line_delivery_source_valid(uuid, varchar, varchar, varchar)
  FROM PUBLIC, cocolo_app;
GRANT EXECUTE ON FUNCTION app_line_delivery_source_valid(uuid, varchar, varchar, varchar)
  TO line_delivery_worker;

-- 旧generic APIで作られた通知元不明のpending行は送信せず、再試行不能なfailedへ隔離する。
WITH quarantined AS (
  UPDATE line_delivery_outbox o
     SET status = 'failed',
         last_error_code = 'source_invalid',
         next_retry_at = NULL,
         lease_expires_at = NULL,
         provider_checked_at = NULL
   WHERE o.status IN ('pending', 'failed')
     AND NOT app_line_delivery_source_valid(
       o.tenant_id, o.source_type, o.source_id, o.deep_link
     )
  RETURNING o.id, o.tenant_id
)
INSERT INTO audit_logs (
  id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata
)
SELECT gen_random_uuid(), tenant_id, 'line-delivery-system',
       'line_delivery.quarantined', 'line_delivery', NULL,
       jsonb_build_object(
         'notificationId', id,
         'status', 'failed',
         'error_code', 'source_invalid'
       )
  FROM quarantined;

CREATE OR REPLACE FUNCTION app_line_notifications_enabled(
  p_tenant_id uuid,
  p_now timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH active_plan AS (
    SELECT 1
      FROM tenant_plans p
     WHERE p.tenant_id = p_tenant_id
       AND p.status IN ('active'::tenant_plan_status, 'trialing'::tenant_plan_status)
       AND p.starts_at <= p_now
       AND (p.ends_at IS NULL OR p_now < p.ends_at)
       AND p.feature_keys @> ARRAY['line-notifications']::text[]
  ),
  active_flag AS (
    SELECT f.enabled, f.source
      FROM tenant_feature_flags f
     WHERE f.tenant_id = p_tenant_id
       AND f.feature_key = 'line-notifications'
       AND f.starts_at <= p_now
       AND (f.ends_at IS NULL OR p_now < f.ends_at)
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM active_flag) THEN
      EXISTS (
        SELECT 1
          FROM active_flag f
         WHERE f.enabled
           AND (
             f.source IN ('operator'::feature_flag_source, 'billing'::feature_flag_source)
             OR EXISTS (SELECT 1 FROM active_plan)
           )
      )
    ELSE EXISTS (SELECT 1 FROM active_plan)
  END;
$$;

REVOKE ALL ON FUNCTION app_line_notifications_enabled(uuid, timestamptz)
  FROM PUBLIC, cocolo_app;
GRANT EXECUTE ON FUNCTION app_line_notifications_enabled(uuid, timestamptz)
  TO line_delivery_worker;

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

  SELECT o.id, o.tenant_id
    INTO candidate_id, candidate_tenant_id
   FROM line_delivery_outbox o
   WHERE o.attempt < p_max_attempts
     AND app_line_notifications_enabled(o.tenant_id, db_now)
     AND app_line_delivery_source_valid(
       o.tenant_id, o.source_type, o.source_id, o.deep_link
     )
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

  SELECT o.id
    INTO locked_candidate_id
    FROM line_delivery_outbox o
   WHERE o.id = candidate_id
     AND o.attempt < p_max_attempts
     AND app_line_notifications_enabled(o.tenant_id, db_now)
     AND app_line_delivery_source_valid(
       o.tenant_id, o.source_type, o.source_id, o.deep_link
     )
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
       AND app_line_notifications_enabled(o.tenant_id, clock_timestamp())
       AND app_line_delivery_source_valid(
         o.tenant_id, o.source_type, o.source_id, o.deep_link
       )
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

REVOKE ALL ON FUNCTION app_claim_line_delivery_outbox(integer, integer)
  FROM PUBLIC, cocolo_app;
GRANT EXECUTE ON FUNCTION app_claim_line_delivery_outbox(integer, integer)
  TO line_delivery_worker;
REVOKE ALL ON FUNCTION app_validate_line_delivery_claim(uuid, uuid, uuid)
  FROM PUBLIC, cocolo_app;
GRANT EXECUTE ON FUNCTION app_validate_line_delivery_claim(uuid, uuid, uuid)
  TO line_delivery_worker;

COMMENT ON FUNCTION app_line_notifications_enabled(uuid, timestamptz) IS
  'APIとworkerで共有する、tenant単位のLINE通知有効判定。判定不能時はfalse';
COMMENT ON FUNCTION app_line_delivery_source_valid(uuid, varchar, varchar, varchar) IS
  'worker送信前に通知元資源、tenant、UUIDv7、アプリ内deep linkを再検証する';
COMMENT ON FUNCTION app_claim_line_delivery_outbox(integer, integer) IS
  'LINE通知のfeature flagと接続世代が有効な通知だけをclaimする';
COMMENT ON FUNCTION app_validate_line_delivery_claim(uuid, uuid, uuid) IS
  '外部送信直前にLINE通知のfeature flagと接続世代を再検証する';
