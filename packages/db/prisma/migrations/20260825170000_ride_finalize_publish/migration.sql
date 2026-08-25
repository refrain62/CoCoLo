-- RIDE-002: 公開後に内容を見直せるよう、確定済み送迎を締切状態へ戻せるようにする。
CREATE OR REPLACE FUNCTION app_guard_ride_state_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'ride_plans' AND NEW.status::text <> 'draft' THEN
      RAISE EXCEPTION '送迎予定はdraftから開始してください';
    END IF;
    IF TG_TABLE_NAME = 'ride_offers' AND NEW.status::text <> 'open' THEN
      RAISE EXCEPTION '送迎提供はopenから開始してください';
    END IF;
    IF TG_TABLE_NAME = 'ride_requests' AND NEW.status::text <> 'pending' THEN
      RAISE EXCEPTION '乗車希望はpendingから開始してください';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF TG_TABLE_NAME = 'ride_plans' AND NOT (
      (OLD.status::text = 'draft' AND NEW.status::text = 'open')
      OR (OLD.status::text = 'open' AND NEW.status::text = 'closed')
      OR (OLD.status::text = 'closed' AND NEW.status::text = 'finalized')
      OR (OLD.status::text = 'finalized' AND NEW.status::text = 'closed')
    ) THEN
      RAISE EXCEPTION '送迎予定の状態遷移が不正です';
    END IF;
    IF TG_TABLE_NAME = 'ride_offers' AND NOT (
      OLD.status::text = 'open' AND NEW.status::text = 'cancelled'
    ) THEN
      RAISE EXCEPTION '送迎提供の状態遷移が不正です';
    END IF;
    IF TG_TABLE_NAME = 'ride_requests' AND NOT (
      (OLD.status::text IN ('pending', 'unassigned') AND NEW.status::text IN ('assigned', 'unassigned', 'cancelled'))
      OR (OLD.status::text = 'assigned' AND NEW.status::text = 'cancelled')
    ) THEN
      RAISE EXCEPTION '乗車希望の状態遷移が不正です';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Repositoryと直接SQLの両方でUUIDv7を生成し、NULLのINSERTを許可しない。
ALTER TABLE ride_plans ALTER COLUMN id SET DEFAULT app_uuidv7();
ALTER TABLE ride_offers ALTER COLUMN id SET DEFAULT app_uuidv7();
ALTER TABLE ride_requests ALTER COLUMN id SET DEFAULT app_uuidv7();
ALTER TABLE ride_assignments ALTER COLUMN id SET DEFAULT app_uuidv7();

-- 既存割当の車変更は、requestを一時状態へ戻さず同一assignment行を更新する。
CREATE OR REPLACE FUNCTION app_guard_ride_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  request_count integer;
  request_status ride_request_status;
  offer_capacity integer;
  assigned_seats integer;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.request_id IS DISTINCT FROM NEW.request_id THEN
    RAISE EXCEPTION '割当対象の乗車希望は変更できません';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':' || NEW.plan_id::text, 0));
  SELECT passenger_count, status INTO request_count, request_status
    FROM ride_requests
   WHERE tenant_id = NEW.tenant_id AND id = NEW.request_id AND plan_id = NEW.plan_id;
  IF request_count IS NULL OR (
       request_status NOT IN ('pending'::ride_request_status, 'unassigned'::ride_request_status)
       AND NOT (
         TG_OP = 'UPDATE'
         AND request_status = 'assigned'::ride_request_status
         AND OLD.request_id = NEW.request_id
       )
     ) OR request_count <> NEW.passenger_count THEN
    RAISE EXCEPTION '割当人数は乗車希望人数と一致させてください';
  END IF;
  SELECT capacity INTO offer_capacity
    FROM ride_offers
   WHERE tenant_id = NEW.tenant_id AND id = NEW.offer_id AND plan_id = NEW.plan_id AND status = 'open'::ride_offer_status;
  IF offer_capacity IS NULL THEN
    RAISE EXCEPTION '受付中の同一送迎の車を指定してください';
  END IF;
  SELECT COALESCE(SUM(passenger_count), 0)::integer INTO assigned_seats
    FROM ride_assignments
   WHERE tenant_id = NEW.tenant_id AND offer_id = NEW.offer_id AND id <> NEW.id;
  IF assigned_seats + NEW.passenger_count > offer_capacity THEN
    RAISE EXCEPTION '車の定員を超える割当です';
  END IF;
  RETURN NEW;
END;
$$;

-- finalizedへの遷移時に、公開可能な配車表の不変条件をDBでも再確認する。
-- Maps列はmanagerまたはfinalizedの利用者向けprojectionからだけ返す。
CREATE OR REPLACE FUNCTION app_ride_plan_rows(target_tenant_id uuid)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  title varchar(200),
  departure_at timestamptz,
  pickup_maps_url varchar(2048),
  destination_maps_url varchar(2048),
  status ride_plan_status,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    rp.id,
    rp.tenant_id,
    rp.title,
    rp.departure_at,
    CASE WHEN app_is_event_manager() OR rp.status = 'finalized'::ride_plan_status
      THEN rp.pickup_maps_url END,
    CASE WHEN app_is_event_manager() OR rp.status = 'finalized'::ride_plan_status
      THEN rp.destination_maps_url END,
    rp.status,
    rp.created_at
  FROM ride_plans rp
  WHERE app_has_active_membership(target_tenant_id)
    AND rp.tenant_id = target_tenant_id
  ORDER BY rp.departure_at ASC, rp.id ASC
  LIMIT 100
$$;

CREATE OR REPLACE FUNCTION app_ride_plan_row(
  target_tenant_id uuid,
  target_plan_id uuid
)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  title varchar(200),
  departure_at timestamptz,
  pickup_maps_url varchar(2048),
  destination_maps_url varchar(2048),
  status ride_plan_status,
  created_at timestamptz
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    rp.id,
    rp.tenant_id,
    rp.title,
    rp.departure_at,
    CASE WHEN app_is_event_manager() OR rp.status = 'finalized'::ride_plan_status
      THEN rp.pickup_maps_url END,
    CASE WHEN app_is_event_manager() OR rp.status = 'finalized'::ride_plan_status
      THEN rp.destination_maps_url END,
    rp.status,
    rp.created_at
  FROM ride_plans rp
  WHERE app_has_active_membership(target_tenant_id)
    AND rp.tenant_id = target_tenant_id
    AND rp.id = target_plan_id
  FOR UPDATE
$$;

REVOKE SELECT ON ride_plans FROM PUBLIC, cocolo_app;
GRANT SELECT (id, tenant_id, title, departure_at, status, created_at)
  ON ride_plans TO cocolo_app;
REVOKE ALL ON FUNCTION app_ride_plan_rows(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_ride_plan_row(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_ride_plan_rows(uuid) TO cocolo_app;
GRANT EXECUTE ON FUNCTION app_ride_plan_row(uuid, uuid) TO cocolo_app;

CREATE OR REPLACE FUNCTION app_guard_ride_plan_finalize()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status::text = 'closed'
     AND NEW.status::text = 'finalized' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':' || NEW.id::text, 0));
    IF EXISTS (
      SELECT 1
        FROM ride_requests
       WHERE tenant_id = NEW.tenant_id
         AND plan_id = NEW.id
         AND status IN ('pending'::ride_request_status, 'unassigned'::ride_request_status)
    ) THEN
      RAISE EXCEPTION '未割当の乗車希望があるため、送迎を確定できません';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM ride_requests r
       WHERE r.tenant_id = NEW.tenant_id
         AND r.plan_id = NEW.id
         AND r.status = 'assigned'::ride_request_status
         AND NOT EXISTS (
           SELECT 1
             FROM ride_assignments a
            WHERE a.tenant_id = r.tenant_id
              AND a.plan_id = r.plan_id
              AND a.request_id = r.id
         )
    ) THEN
      RAISE EXCEPTION '割当のない乗車希望があるため、送迎を確定できません';
    END IF;
    IF EXISTS (
      SELECT r.member_id
        FROM ride_assignments a
        JOIN ride_requests r
          ON r.tenant_id = a.tenant_id AND r.id = a.request_id
       WHERE a.tenant_id = NEW.tenant_id AND a.plan_id = NEW.id
       GROUP BY r.member_id
      HAVING COUNT(*) > 1
    ) THEN
      RAISE EXCEPTION '同じ部員が重複して割り当てられています';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM ride_assignments a
        JOIN ride_requests r
          ON r.tenant_id = a.tenant_id AND r.id = a.request_id
       WHERE a.tenant_id = NEW.tenant_id
         AND a.plan_id = NEW.id
         AND (
           r.status::text <> 'assigned'
           OR r.passenger_count <> a.passenger_count
           OR NOT EXISTS (
             SELECT 1
               FROM ride_offers o
              WHERE o.tenant_id = a.tenant_id
                AND o.id = a.offer_id
                AND o.plan_id = a.plan_id
                AND o.status = 'open'::ride_offer_status
           )
         )
    ) THEN
      RAISE EXCEPTION '割当内容を確認してから、送迎を確定してください';
    END IF;
    IF EXISTS (
      SELECT o.id
        FROM ride_offers o
        JOIN ride_assignments a
          ON a.tenant_id = o.tenant_id
         AND a.offer_id = o.id
         AND a.plan_id = o.plan_id
       WHERE o.tenant_id = NEW.tenant_id AND o.plan_id = NEW.id
       GROUP BY o.id, o.capacity
      HAVING COALESCE(SUM(a.passenger_count), 0) > o.capacity
    ) THEN
      RAISE EXCEPTION '車の定員を超える割当です';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ride_plan_finalize_guard ON ride_plans;
CREATE TRIGGER ride_plan_finalize_guard
BEFORE UPDATE ON ride_plans
FOR EACH ROW EXECUTE FUNCTION app_guard_ride_plan_finalize();

-- 公開後はplanの状態変更以外を許可せず、再編集開始後にrepository経由で変更させる。
CREATE OR REPLACE FUNCTION app_guard_ride_content_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  plan_id uuid;
  plan_status text;
  reopen_reason text;
BEGIN
  IF TG_TABLE_NAME = 'ride_plans' THEN
    IF TG_OP = 'UPDATE' AND OLD.status::text = 'finalized' THEN
      IF NEW.status::text = 'closed'
         AND OLD.title IS NOT DISTINCT FROM NEW.title
         AND OLD.departure_at IS NOT DISTINCT FROM NEW.departure_at
         AND OLD.pickup_maps_url IS NOT DISTINCT FROM NEW.pickup_maps_url
         AND OLD.destination_maps_url IS NOT DISTINCT FROM NEW.destination_maps_url THEN
        reopen_reason := current_setting('app.ride_reopen_reason', true);
        IF COALESCE(reopen_reason, '') NOT IN (
          'schedule_change', 'member_change', 'vehicle_change', 'other'
        ) THEN
          RAISE EXCEPTION '公開後の再編集理由が必要です';
        END IF;
        INSERT INTO audit_logs (
          id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata
        ) VALUES (
          app_uuidv7(), NEW.tenant_id, current_setting('app.user_id', true),
          'ride.plan.reopen', 'ride_plan', NEW.id,
          jsonb_build_object(
            'fromStatus', OLD.status,
            'toStatus', NEW.status,
            'reasonCode', reopen_reason
          )
        );
        RETURN NEW;
      END IF;
      RAISE EXCEPTION '公開済みの送迎は再編集を開始してから変更してください';
    END IF;
    RETURN NEW;
  END IF;
  plan_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.plan_id ELSE NEW.plan_id END;
  IF TG_OP = 'UPDATE'
     AND (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR OLD.plan_id IS DISTINCT FROM NEW.plan_id) THEN
    RAISE EXCEPTION '送迎データの所属予定は変更できません';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id::text ELSE NEW.tenant_id::text END
    || ':' || plan_id::text,
    0
  ));
  SELECT status::text INTO plan_status
    FROM ride_plans
   WHERE tenant_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END
     AND id = plan_id;
  IF TG_TABLE_NAME = 'ride_offers'
     AND TG_OP = 'INSERT'
     AND plan_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION '受付中の送迎予定にだけ車を登録できます';
  END IF;
  IF TG_TABLE_NAME = 'ride_requests' AND TG_OP = 'INSERT' THEN
    IF plan_status IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION '受付中の送迎予定にだけ乗車希望を登録できます';
    END IF;
    IF NOT app_is_live_member(NEW.tenant_id, NEW.member_id) THEN
      RAISE EXCEPTION '停止または退部した部員は乗車希望を登録できません';
    END IF;
  END IF;
  IF plan_status = 'finalized' THEN
    RAISE EXCEPTION '公開済みの送迎は再編集を開始してから変更してください';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ride_plan_content_guard ON ride_plans;
CREATE TRIGGER ride_plan_content_guard
BEFORE UPDATE ON ride_plans
FOR EACH ROW EXECUTE FUNCTION app_guard_ride_content_mutation();
DROP TRIGGER IF EXISTS ride_offer_content_guard ON ride_offers;
CREATE TRIGGER ride_offer_content_guard
BEFORE INSERT OR UPDATE OR DELETE ON ride_offers
FOR EACH ROW EXECUTE FUNCTION app_guard_ride_content_mutation();
DROP TRIGGER IF EXISTS ride_request_content_guard ON ride_requests;
CREATE TRIGGER ride_request_content_guard
BEFORE INSERT OR UPDATE OR DELETE ON ride_requests
FOR EACH ROW EXECUTE FUNCTION app_guard_ride_content_mutation();
DROP TRIGGER IF EXISTS ride_assignment_content_guard ON ride_assignments;
CREATE TRIGGER ride_assignment_content_guard
BEFORE INSERT OR UPDATE OR DELETE ON ride_assignments
FOR EACH ROW EXECUTE FUNCTION app_guard_ride_content_mutation();

-- API projectionだけでなくRLS自身も、確定前の割当を利用者から隠す。
DROP POLICY ride_assignments_read ON ride_assignments;
CREATE POLICY ride_assignments_read ON ride_assignments FOR SELECT
  USING (
    app_has_active_membership(tenant_id)
    AND (
      app_is_event_manager()
      OR (
        EXISTS (
          SELECT 1
            FROM ride_plans rp
           WHERE rp.tenant_id = ride_assignments.tenant_id
             AND rp.id = ride_assignments.plan_id
             AND rp.status = 'finalized'::ride_plan_status
        )
        AND (
          EXISTS (
        SELECT 1 FROM ride_requests rr
         WHERE rr.tenant_id = ride_assignments.tenant_id
           AND rr.id = ride_assignments.request_id
           AND rr.requester_user_id = current_setting('app.user_id', true)
          )
          OR EXISTS (
        SELECT 1 FROM ride_offers ro
         WHERE ro.tenant_id = ride_assignments.tenant_id
           AND ro.id = ride_assignments.offer_id
           AND ro.driver_user_id = current_setting('app.user_id', true)
          )
          OR EXISTS (
        SELECT 1
          FROM ride_requests rr
          JOIN guardian_members gm
            ON gm.tenant_id = rr.tenant_id AND gm.member_id = rr.member_id
         WHERE rr.tenant_id = ride_assignments.tenant_id
           AND rr.id = ride_assignments.request_id
           AND gm.user_id = current_setting('app.user_id', true)
           AND gm.status = 'active'::member_link_status
          )
        )
      )
    )
  );

-- 確定後は本人・担当部員に紐づく車の定員だけを利用者向け投影へ渡す。
CREATE OR REPLACE FUNCTION app_can_view_ride_offer(
  target_tenant_id uuid,
  target_plan_id uuid,
  target_offer_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_has_active_membership(target_tenant_id)
    AND EXISTS (
      SELECT 1
      FROM ride_plans rp
      JOIN ride_assignments ra
        ON ra.tenant_id = rp.tenant_id AND ra.plan_id = rp.id
      JOIN ride_requests rr
        ON rr.tenant_id = ra.tenant_id AND rr.id = ra.request_id
     WHERE rp.tenant_id = target_tenant_id
       AND rp.id = target_plan_id
       AND rp.status = 'finalized'::ride_plan_status
       AND ra.offer_id = target_offer_id
       AND (
         rr.requester_user_id = current_setting('app.user_id', true)
         OR EXISTS (
           SELECT 1
             FROM guardian_members gm
            WHERE gm.tenant_id = rr.tenant_id
              AND gm.member_id = rr.member_id
              AND gm.user_id = current_setting('app.user_id', true)
              AND gm.status = 'active'::member_link_status
         )
       )
  );
$$;
REVOKE ALL ON FUNCTION app_can_view_ride_offer(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_view_ride_offer(uuid, uuid, uuid) TO cocolo_app;
DROP POLICY ride_offers_read ON ride_offers;
CREATE POLICY ride_offers_read ON ride_offers FOR SELECT
  USING (
    app_has_active_membership(tenant_id)
    AND (
      app_is_event_manager()
      OR driver_user_id = current_setting('app.user_id', true)
      OR app_can_view_ride_offer(tenant_id, plan_id, id)
    )
  );

-- repositoryを経由しないSQLでも、受付状態と部員状態を同じ境界で検証する。
DROP POLICY ride_offers_insert ON ride_offers;
CREATE POLICY ride_offers_insert ON ride_offers
  FOR INSERT WITH CHECK (
    app_has_active_membership(tenant_id)
    AND driver_user_id = current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
        FROM ride_plans rp
       WHERE rp.tenant_id = ride_offers.tenant_id
         AND rp.id = ride_offers.plan_id
         AND rp.status = 'open'::ride_plan_status
    )
  );

DROP POLICY ride_requests_insert ON ride_requests;
CREATE POLICY ride_requests_insert ON ride_requests
  FOR INSERT WITH CHECK (
    app_has_active_membership(tenant_id)
    AND requester_user_id = current_setting('app.user_id', true)
    AND app_is_live_member(tenant_id, member_id)
    AND EXISTS (
      SELECT 1
        FROM ride_plans rp
       WHERE rp.tenant_id = ride_requests.tenant_id
         AND rp.id = ride_requests.plan_id
         AND rp.status = 'open'::ride_plan_status
    )
    AND (
      app_is_event_manager()
      OR (
        current_setting('app.role', true) = 'guardian'
        AND EXISTS (
          SELECT 1
            FROM guardian_members gm
           WHERE gm.tenant_id = ride_requests.tenant_id
             AND gm.member_id = ride_requests.member_id
             AND gm.user_id = current_setting('app.user_id', true)
             AND gm.status = 'active'::member_link_status
        )
      )
    )
  );
