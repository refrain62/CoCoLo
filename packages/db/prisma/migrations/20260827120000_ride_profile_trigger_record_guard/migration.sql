-- RIDE-002: membersとtenant_membershipsで異なる行型を受けるtriggerの参照を安全化する。
CREATE OR REPLACE FUNCTION app_lock_ride_driver_plans(target_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  plan_row RECORD;
BEGIN
  IF NOT app_has_active_membership(target_tenant_id) THEN
    RETURN;
  END IF;
  FOR plan_row IN
    SELECT DISTINCT ro.tenant_id, ro.plan_id
      FROM ride_offers ro
      JOIN ride_assignments a
        ON a.tenant_id = ro.tenant_id
       AND a.plan_id = ro.plan_id
       AND a.offer_id = ro.id
     WHERE ro.tenant_id = target_tenant_id
       AND ro.driver_user_id = current_setting('app.user_id', true)
     ORDER BY ro.tenant_id, ro.plan_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      plan_row.tenant_id::text || ':' || plan_row.plan_id::text, 0
    ));
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION app_lock_ride_driver_plans(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_lock_ride_driver_plans(uuid) TO cocolo_app;

CREATE OR REPLACE FUNCTION app_lock_ride_driver_plans(
  target_tenant_id uuid,
  target_plan_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  plan_row RECORD;
BEGIN
  IF NOT app_has_active_membership(target_tenant_id) THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM ride_plans rp
     WHERE rp.tenant_id = target_tenant_id
       AND rp.id = target_plan_id
  ) THEN
    RETURN;
  END IF;
  FOR plan_row IN
    SELECT locked_plans.tenant_id, locked_plans.plan_id
      FROM (
        SELECT DISTINCT ro.tenant_id, ro.plan_id
          FROM ride_offers ro
          JOIN ride_assignments a
            ON a.tenant_id = ro.tenant_id
           AND a.plan_id = ro.plan_id
           AND a.offer_id = ro.id
         WHERE ro.tenant_id = target_tenant_id
           AND ro.driver_user_id = current_setting('app.user_id', true)
        UNION
        SELECT target_tenant_id, target_plan_id
         WHERE target_plan_id IS NOT NULL
      ) AS locked_plans
     ORDER BY locked_plans.tenant_id, locked_plans.plan_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      plan_row.tenant_id::text || ':' || plan_row.plan_id::text, 0
    ));
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION app_lock_ride_driver_plans(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_lock_ride_driver_plans(uuid, uuid) TO cocolo_app;

CREATE OR REPLACE FUNCTION app_guard_ride_published_profile_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  plan_row RECORD;
BEGIN
  IF TG_TABLE_NAME = 'members' THEN
    FOR plan_row IN
      SELECT DISTINCT rr.tenant_id, rr.plan_id
        FROM ride_requests rr
        JOIN ride_assignments a
          ON a.tenant_id = rr.tenant_id
         AND a.plan_id = rr.plan_id
         AND a.request_id = rr.id
       WHERE rr.tenant_id = NEW.tenant_id
         AND rr.member_id = NEW.id
       ORDER BY rr.tenant_id, rr.plan_id
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(
        plan_row.tenant_id::text || ':' || plan_row.plan_id::text, 0
      ));
    END LOOP;
    IF OLD.name IS DISTINCT FROM NEW.name
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
    END IF;
  ELSIF TG_TABLE_NAME = 'tenant_memberships' THEN
    FOR plan_row IN
      SELECT DISTINCT ro.tenant_id, ro.plan_id
        FROM ride_offers ro
        JOIN ride_assignments a
          ON a.tenant_id = ro.tenant_id
         AND a.plan_id = ro.plan_id
         AND a.offer_id = ro.id
       WHERE ro.tenant_id = NEW.tenant_id
         AND ro.driver_user_id = NEW.user_id
       ORDER BY ro.tenant_id, ro.plan_id
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(
        plan_row.tenant_id::text || ':' || plan_row.plan_id::text, 0
      ));
    END LOOP;
    IF OLD.display_name IS DISTINCT FROM NEW.display_name
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
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_guard_ride_published_profile_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_guard_ride_published_profile_mutation() TO cocolo_app;

-- 表示名更新のmembership row lockより先にplan lockを取得し、車登録との循環待ちを防ぐ。
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
  PERFORM app_lock_ride_driver_plans(target_tenant_id);
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
