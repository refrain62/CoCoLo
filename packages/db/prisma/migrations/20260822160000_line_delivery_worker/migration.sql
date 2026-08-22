-- LINE配信workerは利用者JWTを持たないため、dueのclaimと状態更新だけを限定関数へ閉じ込める。
-- 関数はtenant一覧や本文の検索APIにせず、cocolo_appからのみ実行できる内部境界とする。
CREATE OR REPLACE FUNCTION app_claim_due_line_notification(
  p_now timestamptz,
  p_max_attempts integer
)
RETURNS SETOF line_notification_queue
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH candidate AS (
    SELECT q.id
      FROM line_notification_queue q
      JOIN line_connections c
        ON c.tenant_id = q.tenant_id
       AND c.group_id = q.group_id
       AND c.status = 'connected'::line_connection_status
     WHERE p_now IS NOT NULL
       AND p_max_attempts BETWEEN 1 AND 5
       AND q.status IN ('pending'::line_notification_status, 'failed'::line_notification_status)
       AND q.attempts < p_max_attempts
       AND (q.next_retry_at IS NULL OR q.next_retry_at <= p_now)
     ORDER BY q.created_at, q.id
     LIMIT 1
     FOR UPDATE OF q SKIP LOCKED
  )
  UPDATE line_notification_queue q
     SET status = 'sending'::line_notification_status,
         attempts = q.attempts + 1
    FROM candidate
   WHERE q.id = candidate.id
  RETURNING q.*;
$$;

CREATE OR REPLACE FUNCTION app_mark_line_notification_sent(
  p_tenant_id uuid,
  p_notification_id uuid,
  p_provider_message_id varchar(256),
  p_now timestamptz
)
RETURNS SETOF line_notification_queue
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE line_notification_queue
     SET status = 'sent'::line_notification_status,
         provider_message_id = p_provider_message_id,
         sent_at = p_now,
         next_retry_at = NULL
   WHERE tenant_id = p_tenant_id
     AND id = p_notification_id
     AND status = 'sending'::line_notification_status
     AND p_provider_message_id IS NOT NULL
     AND length(trim(p_provider_message_id)) BETWEEN 1 AND 256
     AND p_now IS NOT NULL
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION app_mark_line_notification_failed(
  p_tenant_id uuid,
  p_notification_id uuid,
  p_error varchar(500),
  p_next_retry_at timestamptz,
  p_now timestamptz
)
RETURNS SETOF line_notification_queue
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE line_notification_queue
     SET status = 'failed'::line_notification_status,
         last_error = left(coalesce(p_error, 'LINE送信に失敗しました。'), 500),
         next_retry_at = p_next_retry_at
   WHERE tenant_id = p_tenant_id
     AND id = p_notification_id
     AND status = 'sending'::line_notification_status
     AND p_now IS NOT NULL
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION app_claim_due_line_notification(timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_mark_line_notification_sent(uuid, uuid, varchar, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_mark_line_notification_failed(uuid, uuid, varchar, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_claim_due_line_notification(timestamptz, integer) TO cocolo_app;
GRANT EXECUTE ON FUNCTION app_mark_line_notification_sent(uuid, uuid, varchar, timestamptz) TO cocolo_app;
GRANT EXECUTE ON FUNCTION app_mark_line_notification_failed(uuid, uuid, varchar, timestamptz, timestamptz) TO cocolo_app;

COMMENT ON FUNCTION app_claim_due_line_notification(timestamptz, integer)
  IS 'LINE配信workerがdue通知を一件だけsendingへclaimする。接続済みgroupだけを対象にする';
COMMENT ON FUNCTION app_mark_line_notification_sent(uuid, uuid, varchar, timestamptz)
  IS 'LINE配信workerがsending通知をsentへ確定する';
COMMENT ON FUNCTION app_mark_line_notification_failed(uuid, uuid, varchar, timestamptz, timestamptz)
  IS 'LINE配信workerがsending通知をfailedへ確定し、次回時刻を保存する';
