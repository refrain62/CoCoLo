-- FS-EVT、FS-BRD、FS-ORD、FS-FIL、FS-ANN、FS-NOT、FS-RIDEの中央DB契約。
-- 新規IDはUUIDv7とし、LINE通知キューだけは既存repository互換のためSQL defaultで生成する。

CREATE TYPE event_type AS ENUM ('practice', 'match', 'event');
CREATE TYPE attendance_response AS ENUM ('attending', 'absent', 'pending');
CREATE TYPE attachment_status AS ENUM ('uploaded', 'available', 'rejected', 'deleted');
CREATE TYPE announcement_status AS ENUM ('published', 'archived');
CREATE TYPE purchase_order_status AS ENUM ('open', 'closed', 'completed');
CREATE TYPE payment_status AS ENUM ('unpaid', 'paid');
CREATE TYPE line_connection_status AS ENUM ('connected', 'disconnected');
CREATE TYPE line_notification_source AS ENUM ('event', 'deadline', 'bulletin');
CREATE TYPE line_notification_status AS ENUM ('pending', 'sending', 'sent', 'failed');
CREATE TYPE ride_plan_status AS ENUM ('draft', 'open', 'closed', 'finalized');
CREATE TYPE ride_offer_status AS ENUM ('open', 'cancelled');
CREATE TYPE ride_request_status AS ENUM ('pending', 'assigned', 'unassigned', 'cancelled');

CREATE OR REPLACE FUNCTION app_is_uuidv7(value uuid)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value IS NOT NULL AND ((get_byte(uuid_send(value), 6) >> 4) = 7)
$$;

CREATE OR REPLACE FUNCTION app_uuidv7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  timestamp_hex text;
  random_hex text;
BEGIN
  timestamp_hex := lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0');
  random_hex := md5(random()::text || clock_timestamp()::text || txid_current()::text);
  RETURN (
    timestamp_hex
    || '7'
    || substr(random_hex, 1, 3)
    || to_hex(8 + (get_byte(decode(random_hex, 'hex'), 3) & 3))
    || substr(random_hex, 5, 15)
  )::uuid;
END;
$$;

ALTER TABLE tenants ADD CONSTRAINT tenants_id_uuidv7 CHECK (app_is_uuidv7(id));
ALTER TABLE tenant_memberships ADD CONSTRAINT tenant_memberships_id_uuidv7 CHECK (app_is_uuidv7(id));
ALTER TABLE members ADD CONSTRAINT members_id_uuidv7 CHECK (app_is_uuidv7(id));
ALTER TABLE guardian_members ADD CONSTRAINT guardian_members_id_uuidv7 CHECK (app_is_uuidv7(id));
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_id_uuidv7 CHECK (app_is_uuidv7(id));
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_resource_id_uuidv7 CHECK (resource_id IS NULL OR app_is_uuidv7(resource_id));
ALTER TABLE promotion_runs ADD CONSTRAINT promotion_runs_id_uuidv7 CHECK (app_is_uuidv7(id));

CREATE TABLE attachments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  owner_user_id varchar(128) NOT NULL,
  object_key varchar(512) NOT NULL,
  media_type varchar(64) NOT NULL,
  byte_size integer NOT NULL,
  sha256 char(64),
  status attachment_status NOT NULL DEFAULT 'uploaded',
  expires_at timestamptz NOT NULL,
  complete_attempts integer NOT NULL DEFAULT 0,
  cleanup_attempts integer NOT NULL DEFAULT 0,
  cleanup_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, object_key),
  CHECK (app_is_uuidv7(id)),
  CHECK (media_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  CHECK (byte_size BETWEEN 1 AND 20971520),
  CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (complete_attempts BETWEEN 0 AND 3),
  CHECK (cleanup_attempts >= 0),
  CHECK (status <> 'deleted'::attachment_status OR deleted_at IS NOT NULL),
  CHECK (status = 'deleted'::attachment_status OR deleted_at IS NULL),
  CHECK (position('://' IN object_key) = 0),
  CHECK (left(object_key, 1) <> '/')
);
CREATE INDEX attachments_tenant_status_expiry_idx ON attachments(tenant_id, status, expires_at);

CREATE TABLE events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  title varchar(200) NOT NULL,
  event_type event_type NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  location varchar(500),
  items_to_bring varchar(2000),
  fee integer NOT NULL DEFAULT 0,
  announcement_image_attachment_id uuid,
  opponent varchar(200),
  meeting_time timestamptz,
  transportation_required boolean NOT NULL DEFAULT false,
  attendance_deadline timestamptz NOT NULL,
  created_by_user_id varchar(128) NOT NULL,
  updated_by_user_id varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, announcement_image_attachment_id)
    REFERENCES attachments(tenant_id, id) ON DELETE RESTRICT,
  CHECK (app_is_uuidv7(id)),
  CHECK (ends_at > starts_at),
  CHECK (attendance_deadline <= starts_at),
  CHECK (meeting_time IS NULL OR meeting_time <= starts_at),
  CHECK (fee BETWEEN 0 AND 1000000),
  CHECK (event_type <> 'match'::event_type OR length(btrim(opponent)) > 0)
);
CREATE INDEX events_tenant_starts_idx ON events(tenant_id, starts_at, id);

CREATE TABLE attendance_responses (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL,
  user_id varchar(128) NOT NULL,
  member_id uuid NOT NULL,
  response attendance_response NOT NULL,
  correction_reason varchar(500),
  responded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, event_id, user_id, member_id),
  FOREIGN KEY (tenant_id, event_id) REFERENCES events(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, member_id) REFERENCES members(tenant_id, id) ON DELETE RESTRICT,
  CHECK (app_is_uuidv7(id))
);
CREATE INDEX attendance_responses_event_member_idx ON attendance_responses(tenant_id, event_id, member_id);

CREATE TABLE board_contacts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  fiscal_year integer NOT NULL,
  role_name varchar(100) NOT NULL,
  role_type varchar(16) NOT NULL,
  assignee_user_id varchar(128),
  line_contact varchar(200),
  phone varchar(32),
  contact_preference varchar(8) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, fiscal_year, role_name),
  FOREIGN KEY (tenant_id, assignee_user_id)
    REFERENCES tenant_memberships(tenant_id, user_id) ON DELETE RESTRICT,
  CHECK (app_is_uuidv7(id)),
  CHECK (fiscal_year BETWEEN 2000 AND 2100),
  CHECK (role_type IN ('admin', 'staff', 'member')),
  CHECK (contact_preference IN ('line', 'phone', 'both'))
);
CREATE INDEX board_contacts_tenant_year_idx ON board_contacts(tenant_id, fiscal_year);

CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  title varchar(200) NOT NULL,
  deadline timestamptz NOT NULL,
  status purchase_order_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (app_is_uuidv7(id))
);
CREATE INDEX purchase_orders_tenant_status_deadline_idx ON purchase_orders(tenant_id, status, deadline);

CREATE TABLE order_products (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  name varchar(200) NOT NULL,
  unit_price bigint NOT NULL,
  image_url varchar(2000),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  requires_back_number boolean NOT NULL DEFAULT false,
  requires_back_name boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES purchase_orders(tenant_id, id) ON DELETE RESTRICT,
  CHECK (app_is_uuidv7(id)),
  CHECK (unit_price BETWEEN 0 AND 1000000000),
  CHECK (jsonb_typeof(options) = 'array')
);
CREATE INDEX order_products_tenant_order_created_idx ON order_products(tenant_id, order_id, created_at);

CREATE TABLE order_entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  orderer_user_id varchar(128) NOT NULL,
  orderer_name varchar(200) NOT NULL,
  member_id uuid NOT NULL,
  total_amount bigint NOT NULL DEFAULT 0,
  payment_status payment_status NOT NULL DEFAULT 'unpaid',
  payment_confirmed_at timestamptz,
  payment_confirmed_by varchar(128),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES purchase_orders(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, member_id) REFERENCES members(tenant_id, id) ON DELETE RESTRICT,
  CHECK (app_is_uuidv7(id)),
  CHECK (total_amount BETWEEN 0 AND 9007199254740991),
  CHECK ((payment_status = 'paid'::payment_status AND payment_confirmed_at IS NOT NULL AND payment_confirmed_by IS NOT NULL)
    OR (payment_status = 'unpaid'::payment_status AND payment_confirmed_at IS NULL AND payment_confirmed_by IS NULL))
);
CREATE INDEX order_entries_tenant_order_payment_created_idx ON order_entries(tenant_id, order_id, payment_status, created_at);
CREATE INDEX order_entries_tenant_orderer_idx ON order_entries(tenant_id, orderer_user_id);

CREATE TABLE order_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  order_entry_id uuid NOT NULL,
  product_id uuid NOT NULL,
  product_name varchar(200) NOT NULL,
  unit_price bigint NOT NULL,
  quantity integer NOT NULL,
  selected_options jsonb NOT NULL,
  back_number varchar(20),
  back_name varchar(40),
  amount bigint NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, order_entry_id) REFERENCES order_entries(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, product_id) REFERENCES order_products(tenant_id, id) ON DELETE RESTRICT,
  CHECK (app_is_uuidv7(id)),
  CHECK (unit_price BETWEEN 0 AND 1000000000),
  CHECK (quantity BETWEEN 1 AND 10000),
  CHECK (amount = unit_price * quantity),
  CHECK (amount BETWEEN 0 AND 9007199254740991),
  CHECK (jsonb_typeof(selected_options) = 'object')
);
CREATE INDEX order_lines_tenant_entry_idx ON order_lines(tenant_id, order_entry_id);
CREATE INDEX order_lines_tenant_product_idx ON order_lines(tenant_id, product_id);

CREATE TABLE order_idempotency_keys (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  actor_user_id varchar(128) NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  request_hash char(64) NOT NULL,
  resource_type varchar(64) NOT NULL,
  resource_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, actor_user_id, idempotency_key),
  CHECK (app_is_uuidv7(id)),
  CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CHECK (app_is_uuidv7(resource_id))
);
CREATE INDEX order_idempotency_keys_tenant_resource_idx
  ON order_idempotency_keys(tenant_id, resource_type, resource_id);

CREATE TABLE announcements (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  author_user_id varchar(128) NOT NULL,
  title varchar(200) NOT NULL,
  body varchar(20000) NOT NULL,
  status announcement_status NOT NULL DEFAULT 'published',
  published_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK (app_is_uuidv7(id))
);
CREATE INDEX announcements_tenant_status_published_idx ON announcements(tenant_id, status, published_at, id);

CREATE TABLE announcement_attachments (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  announcement_id uuid NOT NULL,
  attachment_id uuid NOT NULL,
  position integer NOT NULL,
  media_type varchar(64) NOT NULL,
  byte_size integer NOT NULL,
  PRIMARY KEY (tenant_id, announcement_id, attachment_id),
  UNIQUE (tenant_id, announcement_id, position),
  FOREIGN KEY (tenant_id, announcement_id) REFERENCES announcements(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, attachment_id) REFERENCES attachments(tenant_id, id) ON DELETE RESTRICT,
  CHECK (position BETWEEN 0 AND 9),
  CHECK (media_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  CHECK (byte_size BETWEEN 1 AND 20971520)
);

CREATE TABLE announcement_reads (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  announcement_id uuid NOT NULL,
  user_id varchar(128) NOT NULL,
  read_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, announcement_id, user_id),
  FOREIGN KEY (tenant_id, announcement_id) REFERENCES announcements(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX announcement_reads_tenant_user_read_idx ON announcement_reads(tenant_id, user_id, read_at);

CREATE TABLE line_connections (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  group_id varchar(128),
  status line_connection_status NOT NULL,
  connected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, group_id),
  CHECK ((status = 'connected'::line_connection_status AND group_id IS NOT NULL AND connected_at IS NOT NULL)
    OR (status = 'disconnected'::line_connection_status AND group_id IS NULL))
);
CREATE UNIQUE INDEX line_connections_connected_group_idx
  ON line_connections(group_id) WHERE status = 'connected'::line_connection_status;

CREATE TABLE line_notification_queue (
  id uuid PRIMARY KEY DEFAULT app_uuidv7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  group_id varchar(128) NOT NULL,
  created_by_user_id varchar(128) NOT NULL,
  source_type line_notification_source NOT NULL,
  source_id varchar(128) NOT NULL,
  title varchar(200) NOT NULL,
  body varchar(4000) NOT NULL,
  deep_link varchar(2048) NOT NULL,
  status line_notification_status NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  provider_message_id varchar(256),
  last_error varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES line_connections(tenant_id, group_id) ON DELETE RESTRICT,
  CHECK (app_is_uuidv7(id)),
  CHECK (attempts BETWEEN 0 AND 5),
  CHECK ((status = 'sent'::line_notification_status AND sent_at IS NOT NULL)
    OR (status <> 'sent'::line_notification_status AND sent_at IS NULL)),
  CHECK (deep_link ~ '^https://|^http://localhost(:[0-9]+)?/')
);
CREATE INDEX line_notification_queue_due_idx ON line_notification_queue(status, next_retry_at, created_at, id);
CREATE INDEX line_notification_queue_tenant_group_status_idx ON line_notification_queue(tenant_id, group_id, status);

CREATE TABLE line_webhook_receipts (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  group_id varchar(128) NOT NULL,
  webhook_event_id varchar(128) NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, webhook_event_id)
);
CREATE INDEX line_webhook_receipts_tenant_received_idx ON line_webhook_receipts(tenant_id, received_at);

CREATE TABLE ride_plans (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  title varchar(200) NOT NULL,
  departure_at timestamptz NOT NULL,
  pickup_maps_url varchar(2048),
  destination_maps_url varchar(2048),
  status ride_plan_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (app_is_uuidv7(id)),
  CHECK (pickup_maps_url IS NULL OR pickup_maps_url ~ '^https://(www\\.)?google\\.com/maps(/|$)|^https://maps\\.google\\.com/'),
  CHECK (destination_maps_url IS NULL OR destination_maps_url ~ '^https://(www\\.)?google\\.com/maps(/|$)|^https://maps\\.google\\.com/')
);
CREATE INDEX ride_plans_tenant_departure_idx ON ride_plans(tenant_id, departure_at, id);

CREATE TABLE ride_offers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL,
  driver_user_id varchar(128) NOT NULL,
  capacity integer NOT NULL,
  status ride_offer_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES ride_plans(tenant_id, id) ON DELETE RESTRICT,
  CHECK (app_is_uuidv7(id)),
  CHECK (capacity BETWEEN 1 AND 20)
);
CREATE INDEX ride_offers_tenant_plan_status_created_idx ON ride_offers(tenant_id, plan_id, status, created_at);

CREATE TABLE ride_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL,
  member_id uuid NOT NULL,
  requester_user_id varchar(128) NOT NULL,
  passenger_count integer NOT NULL,
  status ride_request_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES ride_plans(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, member_id) REFERENCES members(tenant_id, id) ON DELETE RESTRICT,
  CHECK (app_is_uuidv7(id)),
  CHECK (passenger_count BETWEEN 1 AND 8)
);
CREATE INDEX ride_requests_tenant_plan_status_created_idx ON ride_requests(tenant_id, plan_id, status, created_at);
CREATE INDEX ride_requests_tenant_requester_idx ON ride_requests(tenant_id, requester_user_id);

CREATE TABLE ride_assignments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL,
  request_id uuid NOT NULL,
  offer_id uuid NOT NULL,
  passenger_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, request_id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES ride_plans(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, request_id) REFERENCES ride_requests(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, offer_id) REFERENCES ride_offers(tenant_id, id) ON DELETE RESTRICT,
  CHECK (app_is_uuidv7(id)),
  CHECK (passenger_count BETWEEN 1 AND 8)
);
CREATE INDEX ride_assignments_tenant_plan_offer_idx ON ride_assignments(tenant_id, plan_id, offer_id);

CREATE OR REPLACE FUNCTION app_guard_attachment_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'uploaded'::attachment_status THEN
    RAISE EXCEPTION '添付セッションはuploadedで開始する必要があります';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.tenant_id <> NEW.tenant_id OR OLD.id <> NEW.id OR OLD.owner_user_id <> NEW.owner_user_id
      OR OLD.object_key <> NEW.object_key OR OLD.media_type <> NEW.media_type OR OLD.byte_size <> NEW.byte_size
      OR OLD.created_at <> NEW.created_at THEN
      RAISE EXCEPTION '添付の所有境界と保存メタデータは変更できません';
    END IF;
    IF OLD.status = 'uploaded'::attachment_status AND NEW.status NOT IN ('uploaded'::attachment_status, 'available'::attachment_status, 'rejected'::attachment_status) THEN
      RAISE EXCEPTION 'uploadedからの不正な状態遷移です';
    END IF;
    IF OLD.status = 'available'::attachment_status AND NEW.status NOT IN ('available'::attachment_status, 'deleted'::attachment_status) THEN
      RAISE EXCEPTION 'availableからの不正な状態遷移です';
    END IF;
    IF OLD.status = 'rejected'::attachment_status AND NEW.status NOT IN ('rejected'::attachment_status, 'deleted'::attachment_status) THEN
      RAISE EXCEPTION 'rejectedからの不正な状態遷移です';
    END IF;
    IF OLD.status = 'deleted'::attachment_status AND NEW.status <> 'deleted'::attachment_status THEN
      RAISE EXCEPTION 'deletedから状態を戻せません';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER attachments_state_guard
BEFORE INSERT OR UPDATE ON attachments
FOR EACH ROW EXECUTE FUNCTION app_guard_attachment_state();

CREATE OR REPLACE FUNCTION app_guard_purchase_order_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'open'::purchase_order_status THEN
    RAISE EXCEPTION '募集案件はopenで開始する必要があります';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.tenant_id <> NEW.tenant_id OR OLD.id <> NEW.id THEN
      RAISE EXCEPTION '募集案件のtenantとIDは変更できません';
    END IF;
    IF NOT (
      NEW.status = OLD.status
      OR (OLD.status = 'open'::purchase_order_status AND NEW.status = 'closed'::purchase_order_status)
      OR (OLD.status = 'closed'::purchase_order_status AND NEW.status = 'completed'::purchase_order_status)
    ) THEN
      RAISE EXCEPTION '募集案件の状態遷移が不正です';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER purchase_orders_state_guard
BEFORE INSERT OR UPDATE ON purchase_orders
FOR EACH ROW EXECUTE FUNCTION app_guard_purchase_order_state();

CREATE OR REPLACE FUNCTION app_guard_order_entry_payment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.payment_status = 'paid'::payment_status
    AND (NEW.payment_confirmed_at IS NULL OR NEW.payment_confirmed_by IS NULL) THEN
    RAISE EXCEPTION '支払い済みには確認日時と確認者が必要です';
  END IF;
  IF NEW.payment_status = 'unpaid'::payment_status
    AND (NEW.payment_confirmed_at IS NOT NULL OR NEW.payment_confirmed_by IS NOT NULL) THEN
    RAISE EXCEPTION '未払いには確認情報を保持できません';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_entries_payment_guard
BEFORE INSERT OR UPDATE ON order_entries
FOR EACH ROW EXECUTE FUNCTION app_guard_order_entry_payment();

CREATE OR REPLACE FUNCTION app_guard_order_entry_open()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  order_status purchase_order_status;
  order_deadline timestamptz;
  current_member_status member_status;
BEGIN
  SELECT status, deadline INTO order_status, order_deadline
    FROM purchase_orders
   WHERE tenant_id = NEW.tenant_id AND id = NEW.order_id;
  SELECT status INTO current_member_status
    FROM members
   WHERE tenant_id = NEW.tenant_id AND id = NEW.member_id;
  IF order_status IS DISTINCT FROM 'open'::purchase_order_status OR order_deadline <= now() THEN
    RAISE EXCEPTION '締切済みの募集案件には注文できません';
  END IF;
  IF current_member_status IS DISTINCT FROM 'active'::member_status THEN
    RAISE EXCEPTION '停止または退部した部員は注文できません';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_entries_open_guard
BEFORE INSERT ON order_entries
FOR EACH ROW EXECUTE FUNCTION app_guard_order_entry_open();

CREATE OR REPLACE FUNCTION app_guard_order_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  entry_order uuid;
  product_order uuid;
  registered_price bigint;
  registered_name varchar(200);
BEGIN
  SELECT order_id INTO entry_order
    FROM order_entries
   WHERE tenant_id = NEW.tenant_id AND id = NEW.order_entry_id;
  SELECT order_id, unit_price, name INTO product_order, registered_price, registered_name
    FROM order_products
   WHERE tenant_id = NEW.tenant_id AND id = NEW.product_id;
  IF entry_order IS NULL OR product_order IS NULL OR entry_order <> product_order THEN
    RAISE EXCEPTION '注文明細の商品は同じ募集案件に属している必要があります';
  END IF;
  IF NEW.unit_price <> registered_price OR NEW.product_name <> registered_name THEN
    RAISE EXCEPTION '注文明細の商品スナップショットが商品定義と一致しません';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_lines_reference_guard
BEFORE INSERT OR UPDATE ON order_lines
FOR EACH ROW EXECUTE FUNCTION app_guard_order_line();

CREATE OR REPLACE FUNCTION app_assert_order_entry_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_tenant uuid;
  target_entry uuid;
  expected_total bigint;
  actual_total bigint;
BEGIN
  IF TG_TABLE_NAME = 'order_entries' THEN
    IF TG_OP = 'DELETE' THEN
      target_tenant := OLD.tenant_id;
      target_entry := OLD.id;
    ELSE
      target_tenant := NEW.tenant_id;
      target_entry := NEW.id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    target_tenant := OLD.tenant_id;
    target_entry := OLD.order_entry_id;
  ELSE
    target_tenant := NEW.tenant_id;
    target_entry := NEW.order_entry_id;
  END IF;
  SELECT total_amount INTO expected_total
    FROM order_entries
   WHERE tenant_id = target_tenant AND id = target_entry;
  SELECT COALESCE(SUM(amount), 0) INTO actual_total
    FROM order_lines
   WHERE tenant_id = target_tenant AND order_entry_id = target_entry;
  IF expected_total IS DISTINCT FROM actual_total THEN
    RAISE EXCEPTION '注文合計は明細金額の合計と一致させてください';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER order_entries_total_guard
AFTER INSERT OR UPDATE ON order_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app_assert_order_entry_total();
CREATE CONSTRAINT TRIGGER order_lines_total_guard
AFTER INSERT OR UPDATE OR DELETE ON order_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app_assert_order_entry_total();

CREATE OR REPLACE FUNCTION app_guard_line_connection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.status = 'connected'::line_connection_status AND (NEW.group_id IS NULL OR NEW.connected_at IS NULL))
    OR (NEW.status = 'disconnected'::line_connection_status AND NEW.group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'LINE接続状態とgroup IDが一致しません';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER line_connections_state_guard
BEFORE INSERT OR UPDATE ON line_connections
FOR EACH ROW EXECUTE FUNCTION app_guard_line_connection();

CREATE OR REPLACE FUNCTION app_guard_line_notification_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (NEW.status <> 'pending'::line_notification_status OR NEW.attempts <> 0) THEN
    RAISE EXCEPTION 'LINE通知はpendingとattempts=0で開始する必要があります';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.tenant_id <> NEW.tenant_id OR OLD.id <> NEW.id OR OLD.group_id <> NEW.group_id
      OR OLD.created_by_user_id <> NEW.created_by_user_id OR OLD.source_type <> NEW.source_type
      OR OLD.source_id <> NEW.source_id OR OLD.title <> NEW.title OR OLD.body <> NEW.body
      OR OLD.deep_link <> NEW.deep_link OR OLD.created_at <> NEW.created_at THEN
      RAISE EXCEPTION 'LINE通知の送信対象と本文は変更できません';
    END IF;
    IF NOT (
      NEW.status = OLD.status
      OR (OLD.status IN ('pending'::line_notification_status, 'failed'::line_notification_status) AND NEW.status = 'sending'::line_notification_status)
      OR (OLD.status = 'sending'::line_notification_status AND NEW.status IN ('sent'::line_notification_status, 'failed'::line_notification_status))
      OR (OLD.status = 'failed'::line_notification_status AND NEW.status = 'pending'::line_notification_status AND OLD.attempts < 5)
    ) THEN
      RAISE EXCEPTION 'LINE通知の状態遷移が不正です';
    END IF;
    IF NEW.status = 'sending'::line_notification_status AND NEW.attempts <> OLD.attempts + 1 THEN
      RAISE EXCEPTION 'LINE通知のclaim時はattemptsを1増加させます';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER line_notification_state_guard
BEFORE INSERT OR UPDATE ON line_notification_queue
FOR EACH ROW EXECUTE FUNCTION app_guard_line_notification_state();

CREATE OR REPLACE FUNCTION app_guard_ride_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  request_count integer;
  offer_capacity integer;
  assigned_seats integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':' || NEW.plan_id::text, 0));
  SELECT passenger_count INTO request_count
    FROM ride_requests
   WHERE tenant_id = NEW.tenant_id AND id = NEW.request_id AND plan_id = NEW.plan_id;
  IF request_count IS NULL OR request_count <> NEW.passenger_count THEN
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
CREATE TRIGGER ride_assignments_capacity_guard
BEFORE INSERT OR UPDATE ON ride_assignments
FOR EACH ROW EXECUTE FUNCTION app_guard_ride_assignment();

CREATE OR REPLACE FUNCTION app_has_active_membership(target_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT target_tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM tenant_memberships
      WHERE tenant_id = target_tenant_id
        AND user_id = current_setting('app.user_id', true)
        AND status = 'active'::membership_status
        AND role::text = current_setting('app.role', true)
    )
$$;

CREATE OR REPLACE FUNCTION app_is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.role', true) IN ('owner', 'admin')
$$;

CREATE OR REPLACE FUNCTION app_is_event_manager()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.role', true) IN ('owner', 'admin', 'staff')
$$;

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments FORCE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_responses FORCE ROW LEVEL SECURITY;
ALTER TABLE board_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE order_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_products FORCE ROW LEVEL SECURITY;
ALTER TABLE order_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE order_idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_idempotency_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements FORCE ROW LEVEL SECURITY;
ALTER TABLE announcement_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_attachments FORCE ROW LEVEL SECURITY;
ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_reads FORCE ROW LEVEL SECURITY;
ALTER TABLE line_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE line_notification_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_notification_queue FORCE ROW LEVEL SECURITY;
ALTER TABLE line_webhook_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_webhook_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE ride_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE ride_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_offers FORCE ROW LEVEL SECURITY;
ALTER TABLE ride_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE ride_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY attachments_read ON attachments FOR SELECT
  USING (app_has_active_membership(tenant_id) AND (app_is_event_manager() OR owner_user_id = current_setting('app.user_id', true)));
CREATE POLICY attachments_insert ON attachments FOR INSERT
  WITH CHECK (app_has_active_membership(tenant_id) AND owner_user_id = current_setting('app.user_id', true));
CREATE POLICY attachments_update ON attachments FOR UPDATE
  USING (app_has_active_membership(tenant_id) AND (app_is_event_manager() OR owner_user_id = current_setting('app.user_id', true)))
  WITH CHECK (app_has_active_membership(tenant_id) AND (app_is_event_manager() OR owner_user_id = current_setting('app.user_id', true)));

CREATE POLICY events_read ON events FOR SELECT USING (app_has_active_membership(tenant_id));
CREATE POLICY events_write ON events FOR INSERT
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_event_manager());
CREATE POLICY events_update ON events FOR UPDATE
  USING (app_has_active_membership(tenant_id) AND app_is_event_manager())
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_event_manager());

CREATE POLICY attendance_read ON attendance_responses FOR SELECT
  USING (
    app_has_active_membership(tenant_id)
    AND (app_is_event_manager()
      OR (user_id = current_setting('app.user_id', true)
        AND EXISTS (SELECT 1 FROM guardian_members gm WHERE gm.tenant_id = attendance_responses.tenant_id AND gm.member_id = attendance_responses.member_id AND gm.user_id = current_setting('app.user_id', true))))
  );
CREATE POLICY attendance_insert ON attendance_responses FOR INSERT
  WITH CHECK (
    app_has_active_membership(tenant_id)
    AND (
      app_is_event_manager()
      OR (current_setting('app.role', true) = 'guardian' AND user_id = current_setting('app.user_id', true)
        AND EXISTS (SELECT 1 FROM guardian_members gm WHERE gm.tenant_id = attendance_responses.tenant_id AND gm.member_id = attendance_responses.member_id AND gm.user_id = current_setting('app.user_id', true)))
    )
  );
CREATE POLICY attendance_update ON attendance_responses FOR UPDATE
  USING (
    app_has_active_membership(tenant_id)
    AND (app_is_event_manager()
      OR (user_id = current_setting('app.user_id', true)
        AND EXISTS (SELECT 1 FROM guardian_members gm WHERE gm.tenant_id = attendance_responses.tenant_id AND gm.member_id = attendance_responses.member_id AND gm.user_id = current_setting('app.user_id', true))))
  )
  WITH CHECK (
    app_has_active_membership(tenant_id)
    AND (app_is_event_manager()
      OR (user_id = current_setting('app.user_id', true)
        AND EXISTS (SELECT 1 FROM guardian_members gm WHERE gm.tenant_id = attendance_responses.tenant_id AND gm.member_id = attendance_responses.member_id AND gm.user_id = current_setting('app.user_id', true))))
  );

CREATE POLICY board_contacts_read ON board_contacts FOR SELECT USING (app_has_active_membership(tenant_id));
CREATE POLICY board_contacts_write ON board_contacts FOR INSERT
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_manager());
CREATE POLICY board_contacts_update ON board_contacts FOR UPDATE
  USING (app_has_active_membership(tenant_id) AND app_is_manager())
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_manager());
CREATE POLICY board_contacts_delete ON board_contacts FOR DELETE
  USING (app_has_active_membership(tenant_id) AND app_is_manager());

CREATE POLICY purchase_orders_read ON purchase_orders
  FOR SELECT USING (app_has_active_membership(tenant_id) AND current_setting('app.role', true) IN ('owner', 'admin', 'guardian'));
CREATE POLICY purchase_orders_write ON purchase_orders FOR INSERT
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_manager());
CREATE POLICY purchase_orders_update ON purchase_orders FOR UPDATE
  USING (app_has_active_membership(tenant_id) AND app_is_manager())
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_manager());

CREATE POLICY order_products_read ON order_products
  FOR SELECT USING (app_has_active_membership(tenant_id) AND current_setting('app.role', true) IN ('owner', 'admin', 'guardian'));
CREATE POLICY order_products_write ON order_products FOR INSERT
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_manager());
CREATE POLICY order_products_update ON order_products FOR UPDATE
  USING (app_has_active_membership(tenant_id) AND app_is_manager())
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_manager());

CREATE POLICY order_entries_read ON order_entries
  FOR SELECT USING (
    app_has_active_membership(tenant_id)
    AND (app_is_manager()
      OR (orderer_user_id = current_setting('app.user_id', true)
        AND EXISTS (SELECT 1 FROM guardian_members gm WHERE gm.tenant_id = order_entries.tenant_id AND gm.member_id = order_entries.member_id AND gm.user_id = current_setting('app.user_id', true))))
  );
CREATE POLICY order_entries_insert ON order_entries
  FOR INSERT WITH CHECK (
    app_has_active_membership(tenant_id)
    AND current_setting('app.role', true) = 'guardian'
    AND orderer_user_id = current_setting('app.user_id', true)
    AND EXISTS (SELECT 1 FROM guardian_members gm WHERE gm.tenant_id = order_entries.tenant_id AND gm.member_id = order_entries.member_id AND gm.user_id = current_setting('app.user_id', true))
  );
CREATE POLICY order_entries_update ON order_entries FOR UPDATE
  USING (app_has_active_membership(tenant_id) AND app_is_manager())
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_manager());

CREATE POLICY order_lines_read ON order_lines
  FOR SELECT USING (
    app_has_active_membership(tenant_id)
    AND EXISTS (SELECT 1 FROM order_entries oe WHERE oe.tenant_id = order_lines.tenant_id AND oe.id = order_lines.order_entry_id
      AND (app_is_manager() OR oe.orderer_user_id = current_setting('app.user_id', true)))
  );
CREATE POLICY order_lines_insert ON order_lines
  FOR INSERT WITH CHECK (
    app_has_active_membership(tenant_id)
    AND current_setting('app.role', true) = 'guardian'
    AND EXISTS (SELECT 1 FROM order_entries oe
      WHERE oe.tenant_id = order_lines.tenant_id AND oe.id = order_lines.order_entry_id
        AND oe.orderer_user_id = current_setting('app.user_id', true)
        AND EXISTS (SELECT 1 FROM guardian_members gm WHERE gm.tenant_id = oe.tenant_id AND gm.member_id = oe.member_id AND gm.user_id = current_setting('app.user_id', true)))
  );
CREATE POLICY order_lines_update ON order_lines FOR UPDATE
  USING (app_has_active_membership(tenant_id) AND app_is_manager())
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_manager());
CREATE POLICY order_idempotency_read ON order_idempotency_keys FOR SELECT
  USING (app_has_active_membership(tenant_id) AND (app_is_manager() OR actor_user_id = current_setting('app.user_id', true)));
CREATE POLICY order_idempotency_insert ON order_idempotency_keys FOR INSERT
  WITH CHECK (app_has_active_membership(tenant_id) AND actor_user_id = current_setting('app.user_id', true));

CREATE POLICY announcements_read ON announcements FOR SELECT
  USING (app_has_active_membership(tenant_id) AND status = 'published'::announcement_status);
CREATE POLICY announcements_insert ON announcements FOR INSERT
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_event_manager() AND author_user_id = current_setting('app.user_id', true));
CREATE POLICY announcement_attachments_read ON announcement_attachments FOR SELECT USING (app_has_active_membership(tenant_id));
CREATE POLICY announcement_attachments_insert ON announcement_attachments FOR INSERT
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_event_manager());
CREATE POLICY announcement_reads_read ON announcement_reads FOR SELECT
  USING (
    app_has_active_membership(tenant_id)
    AND (user_id = current_setting('app.user_id', true)
        OR (announcement_id = NULLIF(current_setting('app.announcement_id', true), '')::uuid
        AND EXISTS (SELECT 1 FROM announcements a WHERE a.tenant_id = announcement_reads.tenant_id AND a.id = announcement_reads.announcement_id AND a.author_user_id = current_setting('app.user_id', true))))
  );
CREATE POLICY announcement_reads_insert ON announcement_reads FOR INSERT
  WITH CHECK (app_has_active_membership(tenant_id) AND user_id = current_setting('app.user_id', true));

CREATE POLICY line_connections_read ON line_connections FOR SELECT USING (app_has_active_membership(tenant_id));
CREATE POLICY line_connections_write ON line_connections FOR INSERT
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_manager());
CREATE POLICY line_connections_update ON line_connections FOR UPDATE
  USING (app_has_active_membership(tenant_id) AND app_is_manager())
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_manager());
CREATE POLICY line_queue_read ON line_notification_queue FOR SELECT
  USING (app_has_active_membership(tenant_id) AND app_is_event_manager());
CREATE POLICY line_queue_insert ON line_notification_queue FOR INSERT
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_event_manager() AND created_by_user_id = current_setting('app.user_id', true));
CREATE POLICY line_queue_update ON line_notification_queue FOR UPDATE
  USING (app_has_active_membership(tenant_id) AND app_is_event_manager())
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_event_manager());
CREATE POLICY line_receipts_read ON line_webhook_receipts FOR SELECT USING (app_has_active_membership(tenant_id));
CREATE POLICY line_receipts_insert ON line_webhook_receipts FOR INSERT
  WITH CHECK (app_has_active_membership(tenant_id));

CREATE POLICY ride_plans_read ON ride_plans FOR SELECT USING (app_has_active_membership(tenant_id));
CREATE POLICY ride_plans_insert ON ride_plans FOR INSERT
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_event_manager());
CREATE POLICY ride_plans_update ON ride_plans FOR UPDATE
  USING (app_has_active_membership(tenant_id) AND app_is_event_manager())
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_event_manager());
CREATE POLICY ride_offers_read ON ride_offers FOR SELECT
  USING (app_has_active_membership(tenant_id) AND (app_is_event_manager() OR driver_user_id = current_setting('app.user_id', true)));
CREATE POLICY ride_offers_insert ON ride_offers FOR INSERT
  WITH CHECK (app_has_active_membership(tenant_id) AND driver_user_id = current_setting('app.user_id', true));
CREATE POLICY ride_offers_update ON ride_offers FOR UPDATE
  USING (app_has_active_membership(tenant_id) AND (app_is_event_manager() OR driver_user_id = current_setting('app.user_id', true)))
  WITH CHECK (app_has_active_membership(tenant_id) AND (app_is_event_manager() OR driver_user_id = current_setting('app.user_id', true)));
CREATE POLICY ride_requests_read ON ride_requests FOR SELECT
  USING (
    app_has_active_membership(tenant_id)
    AND (app_is_event_manager() OR requester_user_id = current_setting('app.user_id', true)
      OR EXISTS (SELECT 1 FROM guardian_members gm WHERE gm.tenant_id = ride_requests.tenant_id AND gm.member_id = ride_requests.member_id AND gm.user_id = current_setting('app.user_id', true)))
  );
CREATE POLICY ride_requests_insert ON ride_requests FOR INSERT
  WITH CHECK (
    app_has_active_membership(tenant_id)
    AND requester_user_id = current_setting('app.user_id', true)
      AND (app_is_event_manager() OR (current_setting('app.role', true) = 'guardian'
      AND EXISTS (SELECT 1 FROM guardian_members gm WHERE gm.tenant_id = ride_requests.tenant_id AND gm.member_id = ride_requests.member_id AND gm.user_id = current_setting('app.user_id', true))))
  );
CREATE POLICY ride_requests_update ON ride_requests FOR UPDATE
  USING (app_has_active_membership(tenant_id) AND app_is_event_manager())
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_event_manager());
CREATE POLICY ride_assignments_read ON ride_assignments FOR SELECT
  USING (
    app_has_active_membership(tenant_id)
    AND (app_is_event_manager()
      OR EXISTS (SELECT 1 FROM ride_requests rr WHERE rr.tenant_id = ride_assignments.tenant_id AND rr.id = ride_assignments.request_id AND rr.requester_user_id = current_setting('app.user_id', true))
      OR EXISTS (SELECT 1 FROM ride_offers ro WHERE ro.tenant_id = ride_assignments.tenant_id AND ro.id = ride_assignments.offer_id AND ro.driver_user_id = current_setting('app.user_id', true)))
  );
CREATE POLICY ride_assignments_write ON ride_assignments FOR INSERT
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_event_manager());
CREATE POLICY ride_assignments_update ON ride_assignments FOR UPDATE
  USING (app_has_active_membership(tenant_id) AND app_is_event_manager())
  WITH CHECK (app_has_active_membership(tenant_id) AND app_is_event_manager());
CREATE POLICY ride_assignments_delete ON ride_assignments FOR DELETE
  USING (app_has_active_membership(tenant_id) AND app_is_event_manager());

CREATE OR REPLACE FUNCTION app_reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '監査ログは追記専用です';
END;
$$;
CREATE TRIGGER audit_logs_append_only_guard
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION app_reject_audit_mutation();
REVOKE UPDATE, DELETE ON audit_logs FROM cocolo_app;

GRANT USAGE ON TYPE event_type, attendance_response, attachment_status, announcement_status,
  purchase_order_status, payment_status, line_connection_status, line_notification_source,
  line_notification_status, ride_plan_status, ride_offer_status, ride_request_status TO cocolo_app;
GRANT SELECT, INSERT, UPDATE ON attachments, events, attendance_responses, purchase_orders,
  order_products, order_entries, order_lines, order_idempotency_keys, announcements,
  announcement_attachments, announcement_reads, line_connections, line_notification_queue,
  line_webhook_receipts,
  ride_plans, ride_offers, ride_requests TO cocolo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON board_contacts TO cocolo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ride_assignments TO cocolo_app;

COMMENT ON TABLE attachments IS 'R2非公開オブジェクトのメタデータと検証状態';
COMMENT ON TABLE events IS 'チームの予定と出欠締切';
COMMENT ON TABLE attendance_responses IS '予定ごとの部員出欠回答';
COMMENT ON TABLE board_contacts IS '年度役職枠と権限付き連絡先';
COMMENT ON TABLE purchase_orders IS '共同購買の募集案件';
COMMENT ON TABLE order_products IS '募集案件に属する商品と選択肢定義';
COMMENT ON TABLE order_entries IS '対象部員ごとの注文と集金状態';
COMMENT ON TABLE order_lines IS '注文の商品別明細と金額スナップショット';
COMMENT ON TABLE order_idempotency_keys IS '注文操作のtenant・利用者単位の冪等キーとリクエストハッシュ';
COMMENT ON TABLE announcements IS 'チーム内回覧板の本文と公開状態';
COMMENT ON TABLE announcement_attachments IS '回覧板に紐付く添付メタデータの順序';
COMMENT ON TABLE announcement_reads IS '利用者ごとの回覧既読時刻';
COMMENT ON TABLE line_connections IS 'LINEグループとテナントの接続状態';
COMMENT ON TABLE line_notification_queue IS 'LINE通知の再送可能な送信キュー';
COMMENT ON TABLE line_webhook_receipts IS 'LINE Webhookの重複排除記録';
COMMENT ON TABLE ride_plans IS '送迎予定と受付状態';
COMMENT ON TABLE ride_offers IS '送迎を提供する車と定員';
COMMENT ON TABLE ride_requests IS '部員ごとの乗車希望';
COMMENT ON TABLE ride_assignments IS '乗車希望と車の割当';

COMMENT ON COLUMN attachments.object_key IS 'R2内部オブジェクトキー。公開URLや個人情報を保存しない';
COMMENT ON COLUMN attachments.status IS 'uploadedからavailableまたはrejected、cleanup後にdeletedへ遷移する状態';
COMMENT ON COLUMN events.attendance_deadline IS '出欠をguardianが変更できる期限';
COMMENT ON COLUMN attendance_responses.correction_reason IS '締切後の管理修正理由。監査にも記録する';
COMMENT ON COLUMN board_contacts.contact_preference IS '連絡先の投影規則。line、phone、bothのいずれか';
COMMENT ON COLUMN order_products.options IS '商品選択肢のJSON。APIが許可値を再照合する';
COMMENT ON COLUMN order_entries.total_amount IS '明細amountの合計。order_lines triggerで再計算する';
COMMENT ON COLUMN order_entries.payment_status IS '現金または振込の確認状態。オンライン決済状態ではない';
COMMENT ON COLUMN order_lines.selected_options IS '登録済み選択肢から選択した値のJSONオブジェクト';
COMMENT ON COLUMN order_idempotency_keys.request_hash IS '同じIdempotency-Keyの内容一致を検証するSHA-256';
COMMENT ON COLUMN announcement_attachments.attachment_id IS '同一tenantのavailable添付だけを参照する複合外部キー';
COMMENT ON COLUMN line_connections.group_id IS 'LINE外部グループ識別子。tenantをまたいでconnected重複させない';
COMMENT ON COLUMN line_notification_queue.source_id IS '予定、締切、回覧の外部資源識別子';
COMMENT ON COLUMN line_webhook_receipts.webhook_event_id IS 'LINEから受け取った重複排除用イベント識別子';
COMMENT ON COLUMN ride_assignments.passenger_count IS 'requestの人数と一致し、車の定員を超えない割当人数';

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
