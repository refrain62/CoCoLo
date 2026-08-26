-- RIDE-002: 利用者向けに、同一tenantの確定配車へ安全な表示名を投影する。
ALTER TABLE tenant_memberships
  ADD COLUMN IF NOT EXISTS display_name varchar(200);

COMMENT ON COLUMN tenant_memberships.display_name IS '同一tenant内で利用者が公開する表示名';

CREATE OR REPLACE FUNCTION app_guard_ride_driver_display_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status::text = 'closed'
     AND NEW.status::text = 'finalized' THEN
    IF EXISTS (
      SELECT 1
        FROM ride_assignments a
        JOIN ride_offers o
          ON o.tenant_id = a.tenant_id
         AND o.id = a.offer_id
         AND o.plan_id = a.plan_id
        LEFT JOIN tenant_memberships tm
          ON tm.tenant_id = o.tenant_id
         AND tm.user_id = o.driver_user_id
         AND tm.status = 'active'::membership_status
       WHERE a.tenant_id = NEW.tenant_id
         AND a.plan_id = NEW.id
         AND (
           NULLIF(BTRIM(COALESCE(tm.display_name, '')), '') IS NULL
         )
    ) THEN
      RAISE EXCEPTION '運転者の表示名を設定してから送迎を確定してください';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ride_plan_driver_display_name_guard ON ride_plans;
CREATE TRIGGER ride_plan_driver_display_name_guard
BEFORE UPDATE ON ride_plans
FOR EACH ROW EXECUTE FUNCTION app_guard_ride_driver_display_name();

-- 確定公開中はプロフィール名を固定し、再編集開始後にだけ表示名を変更できるようにする。
CREATE OR REPLACE FUNCTION app_guard_ride_published_profile_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'members'
     AND OLD.name IS DISTINCT FROM NEW.name
     AND EXISTS (
       SELECT 1
         FROM ride_requests rr
         JOIN ride_assignments a
           ON a.tenant_id = rr.tenant_id
          AND a.plan_id = rr.plan_id
          AND a.request_id = rr.id
         JOIN ride_plans rp
           ON rp.tenant_id = a.tenant_id
          AND rp.id = a.plan_id
        WHERE rr.tenant_id = NEW.tenant_id
          AND rr.member_id = NEW.id
          AND rp.status = 'finalized'::ride_plan_status
     ) THEN
    RAISE EXCEPTION '確定公開中の部員名は再編集開始後に変更してください';
  ELSIF TG_TABLE_NAME = 'tenant_memberships'
        AND OLD.display_name IS DISTINCT FROM NEW.display_name
        AND EXISTS (
          SELECT 1
            FROM ride_offers ro
            JOIN ride_assignments a
              ON a.tenant_id = ro.tenant_id
             AND a.plan_id = ro.plan_id
             AND a.offer_id = ro.id
            JOIN ride_plans rp
              ON rp.tenant_id = a.tenant_id
             AND rp.id = a.plan_id
           WHERE ro.tenant_id = NEW.tenant_id
             AND ro.driver_user_id = NEW.user_id
             AND rp.status = 'finalized'::ride_plan_status
        ) THEN
    RAISE EXCEPTION '確定公開中の運転者名は再編集開始後に変更してください';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_guard_ride_published_profile_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_guard_ride_published_profile_mutation() TO cocolo_app;
DROP TRIGGER IF EXISTS ride_member_published_name_guard ON members;
CREATE TRIGGER ride_member_published_name_guard
BEFORE UPDATE OF name ON members
FOR EACH ROW EXECUTE FUNCTION app_guard_ride_published_profile_mutation();
DROP TRIGGER IF EXISTS ride_membership_published_name_guard ON tenant_memberships;
CREATE TRIGGER ride_membership_published_name_guard
BEFORE UPDATE OF display_name ON tenant_memberships
FOR EACH ROW EXECUTE FUNCTION app_guard_ride_published_profile_mutation();

-- 運転者本人が自分の所属表示名だけを更新できるようにし、user_idをHTTP入力へ出さない。
CREATE OR REPLACE FUNCTION app_set_ride_display_name(
  target_tenant_id uuid,
  new_display_name text
)
RETURNS varchar(200)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  normalized_name text := BTRIM(COALESCE(new_display_name, ''));
  membership_id uuid;
  previous_name varchar(200);
  updated_name varchar(200);
BEGIN
  IF NOT app_has_active_membership(target_tenant_id)
     OR normalized_name = ''
     OR char_length(normalized_name) > 200 THEN
    RAISE EXCEPTION '表示名の入力が不正です';
  END IF;
  SELECT id, display_name
    INTO membership_id, previous_name
    FROM tenant_memberships
   WHERE tenant_id = target_tenant_id
     AND user_id = current_setting('app.user_id', true)
     AND status = 'active'::membership_status
   FOR UPDATE;
  IF membership_id IS NULL THEN
    RAISE EXCEPTION '表示名を更新できません';
  END IF;
  UPDATE tenant_memberships
     SET display_name = normalized_name
   WHERE id = membership_id
  RETURNING display_name INTO updated_name;
  IF previous_name IS DISTINCT FROM updated_name THEN
    INSERT INTO audit_logs (
      id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata
    ) VALUES (
      app_uuidv7(), target_tenant_id,
      current_setting('app.user_id', true),
      'ride.display_name.update', 'tenant_membership', membership_id,
      jsonb_build_object('fields', jsonb_build_array('displayName'))
    );
  END IF;
  RETURN updated_name;
END;
$$;

REVOKE ALL ON FUNCTION app_set_ride_display_name(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_set_ride_display_name(uuid, text) TO cocolo_app;

-- SECURITY DEFINERでmembershipの直接SELECTを避け、本人・担当部員・担当車の確定行だけを返す。
CREATE OR REPLACE FUNCTION app_ride_confirmed_assignments(
  target_tenant_id uuid,
  target_plan_id uuid
)
RETURNS TABLE (
  id uuid,
  request_id uuid,
  offer_id uuid,
  passenger_count integer,
  member_name varchar(200),
  driver_name varchar(200)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    a.id,
    a.request_id,
    a.offer_id,
    a.passenger_count,
    m.name,
    tm.display_name
  FROM ride_assignments a
  JOIN ride_plans rp
    ON rp.tenant_id = a.tenant_id
   AND rp.id = a.plan_id
  JOIN ride_requests rr
    ON rr.tenant_id = a.tenant_id
   AND rr.id = a.request_id
  JOIN members m
    ON m.tenant_id = rr.tenant_id
   AND m.id = rr.member_id
  JOIN ride_offers ro
    ON ro.tenant_id = a.tenant_id
   AND ro.id = a.offer_id
   AND ro.plan_id = a.plan_id
  JOIN tenant_memberships tm
    ON tm.tenant_id = ro.tenant_id
   AND tm.user_id = ro.driver_user_id
  WHERE app_has_active_membership(target_tenant_id)
    AND a.tenant_id = target_tenant_id
    AND a.plan_id = target_plan_id
    AND rp.status = 'finalized'::ride_plan_status
    AND NULLIF(BTRIM(tm.display_name), '') IS NOT NULL
    AND (
      app_is_event_manager()
      OR rr.requester_user_id = current_setting('app.user_id', true)
      OR ro.driver_user_id = current_setting('app.user_id', true)
      OR EXISTS (
        SELECT 1
          FROM guardian_members gm
         WHERE gm.tenant_id = rr.tenant_id
           AND gm.member_id = rr.member_id
           AND gm.user_id = current_setting('app.user_id', true)
           AND gm.status = 'active'::member_link_status
      )
    )
  ORDER BY a.id ASC
$$;

REVOKE ALL ON FUNCTION app_ride_confirmed_assignments(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_ride_confirmed_assignments(uuid, uuid) TO cocolo_app;
