-- board_contactsの直接SELECTを撤去し、tenant・所属・roleをDB関数内で再検証する。
CREATE OR REPLACE FUNCTION app_board_contact_rows(
  target_tenant_id uuid,
  target_fiscal_year integer DEFAULT NULL,
  include_private boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  fiscal_year integer,
  role_name varchar(100),
  role_type varchar(16),
  assignee_user_id varchar(128),
  line_contact varchar(200),
  phone varchar(32),
  contact_preference varchar(8),
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    board_contact.id,
    board_contact.tenant_id,
    board_contact.fiscal_year,
    board_contact.role_name,
    board_contact.role_type,
    CASE WHEN include_private AND app_is_manager() THEN board_contact.assignee_user_id END,
    CASE WHEN include_private AND app_is_manager() THEN board_contact.line_contact END,
    CASE WHEN include_private AND app_is_manager() THEN board_contact.phone END,
    board_contact.contact_preference,
    board_contact.created_at,
    board_contact.updated_at
  FROM board_contacts AS board_contact
  WHERE app_has_active_membership(target_tenant_id)
    AND board_contact.tenant_id = target_tenant_id
    AND (
      target_fiscal_year IS NULL
      OR board_contact.fiscal_year = target_fiscal_year
    )
  ORDER BY board_contact.fiscal_year DESC, board_contact.role_name ASC, board_contact.id ASC
$$;

CREATE OR REPLACE FUNCTION app_board_contact_manager_row(
  target_tenant_id uuid,
  target_board_contact_id uuid
)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  fiscal_year integer,
  role_name varchar(100),
  role_type varchar(16),
  assignee_user_id varchar(128),
  line_contact varchar(200),
  phone varchar(32),
  contact_preference varchar(8),
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    board_contact.id,
    board_contact.tenant_id,
    board_contact.fiscal_year,
    board_contact.role_name,
    board_contact.role_type,
    board_contact.assignee_user_id,
    board_contact.line_contact,
    board_contact.phone,
    board_contact.contact_preference,
    board_contact.created_at,
    board_contact.updated_at
  FROM board_contacts AS board_contact
  WHERE app_has_active_membership(target_tenant_id)
    AND app_is_manager()
    AND board_contact.tenant_id = target_tenant_id
    AND board_contact.id = target_board_contact_id
  FOR UPDATE
$$;

CREATE OR REPLACE FUNCTION app_board_contact_role_exists(
  target_tenant_id uuid,
  target_fiscal_year integer,
  target_role_name varchar(100),
  except_board_contact_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_has_active_membership(target_tenant_id)
    AND app_is_manager()
    AND EXISTS (
      SELECT 1
      FROM board_contacts AS board_contact
      WHERE board_contact.tenant_id = target_tenant_id
        AND board_contact.fiscal_year = target_fiscal_year
        AND board_contact.role_name = target_role_name
        AND (
          except_board_contact_id IS NULL
          OR board_contact.id <> except_board_contact_id
        )
    )
$$;

REVOKE SELECT ON board_contacts FROM PUBLIC, cocolo_app;
GRANT INSERT, UPDATE, DELETE ON board_contacts TO cocolo_app;

REVOKE ALL ON FUNCTION app_board_contact_rows(uuid, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_board_contact_manager_row(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_board_contact_role_exists(uuid, integer, varchar, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_board_contact_rows(uuid, integer, boolean) TO cocolo_app;
GRANT EXECUTE ON FUNCTION app_board_contact_manager_row(uuid, uuid) TO cocolo_app;
GRANT EXECUTE ON FUNCTION app_board_contact_role_exists(uuid, integer, varchar, uuid) TO cocolo_app;

COMMENT ON FUNCTION app_board_contact_rows(uuid, integer, boolean) IS '役員枠をtenant・active membershipで投影し、非管理者には連絡先PIIを返さない';
COMMENT ON FUNCTION app_board_contact_manager_row(uuid, uuid) IS '管理者だけが同一tenantの役員連絡先を行ロック付きで取得する';
COMMENT ON FUNCTION app_board_contact_role_exists(uuid, integer, varchar, uuid) IS '管理者だけが同一tenant・年度の役職名重複を確認する';
