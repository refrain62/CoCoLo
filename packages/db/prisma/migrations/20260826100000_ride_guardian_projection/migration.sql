-- RIDE-002: 利用者向けに、同一tenantの確定配車へ安全な表示名を投影する。
ALTER TABLE tenant_memberships
  ADD COLUMN IF NOT EXISTS display_name varchar(200);

ALTER TABLE ride_offers
  ADD COLUMN IF NOT EXISTS driver_display_name varchar(200);

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
       WHERE a.tenant_id = NEW.tenant_id
         AND a.plan_id = NEW.id
         AND (
           NULLIF(BTRIM(o.driver_display_name), '') IS NULL
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
  updated_name varchar(200);
BEGIN
  IF NOT app_has_active_membership(target_tenant_id)
     OR normalized_name = ''
     OR char_length(normalized_name) > 200 THEN
    RAISE EXCEPTION '表示名の入力が不正です';
  END IF;
  UPDATE tenant_memberships
     SET display_name = normalized_name
   WHERE tenant_id = target_tenant_id
     AND user_id = current_setting('app.user_id', true)
     AND status = 'active'::membership_status
  RETURNING display_name INTO updated_name;
  IF updated_name IS NULL THEN
    RAISE EXCEPTION '表示名を更新できません';
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
    ro.driver_display_name
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
  WHERE app_has_active_membership(target_tenant_id)
    AND a.tenant_id = target_tenant_id
    AND a.plan_id = target_plan_id
    AND rp.status = 'finalized'::ride_plan_status
    AND NULLIF(BTRIM(ro.driver_display_name), '') IS NOT NULL
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
