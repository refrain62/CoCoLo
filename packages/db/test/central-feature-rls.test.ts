import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { PrismaClient as PrismaClientType } from '@prisma/client';
import prismaClientPackage from '@prisma/client';

const { PrismaClient } = prismaClientPackage;
type PrismaClient = PrismaClientType;

const tenantA = '00000000-0000-7000-8000-000000000001';
const tenantB = '00000000-0000-7000-8000-000000000002';
const memberA = '00000000-0000-7000-8000-000000000201';
const memberA2 = '00000000-0000-7000-8000-000000000202';
const eventA = '00000000-0000-7000-8000-000000000401';
const eventB = '00000000-0000-7000-8000-000000000402';
const attachmentA = '00000000-0000-7000-8000-000000000501';
const attachmentB = '00000000-0000-7000-8000-000000000502';
const boardContactA = '00000000-0000-7000-8000-000000000601';
const orderA = '00000000-0000-7000-8000-000000000701';
const productA = '00000000-0000-7000-8000-000000000702';
const entryA = '00000000-0000-7000-8000-000000000703';
const lineA = '00000000-0000-7000-8000-000000000704';
const idempotencyA = '00000000-0000-7000-8000-000000000705';
const announcementA = '00000000-0000-7000-8000-000000000801';
let notificationA = '';
const ridePlanA = '00000000-0000-7000-8000-000000001001';
const rideOfferA = '00000000-0000-7000-8000-000000001002';
const rideRequestA = '00000000-0000-7000-8000-000000001003';
const rideAssignmentA = '00000000-0000-7000-8000-000000001004';
const auditA = '00000000-0000-7000-8000-000000001101';

const appUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;
const enabled = Boolean(appUrl && directUrl);
let app: PrismaClient | undefined;
let direct: PrismaClient | undefined;

async function rows<T>(
  client: PrismaClient,
  sql: string,
  ...values: unknown[]
) {
  return client.$queryRawUnsafe<T[]>(sql, ...values);
}

async function execute(
  client: PrismaClient,
  sql: string,
  ...values: unknown[]
) {
  await client.$executeRawUnsafe(sql, ...values);
}

async function count(client: PrismaClient, table: string) {
  const result = await rows<{ count: bigint }>(
    client,
    `SELECT count(*)::bigint AS count FROM ${table}`,
  );
  return Number(result[0]?.count ?? 0n);
}

async function withContext<T>(
  client: PrismaClient,
  tenantId: string,
  userId: string,
  role: string,
  work: (transaction: PrismaClient) => Promise<T>,
) {
  return client.$transaction(async (transaction) => {
    await execute(
      transaction,
      `SELECT set_config('app.tenant_id', $1, true),
              set_config('app.user_id', $2, true),
              set_config('app.role', $3, true),
              set_config('app.announcement_id', '', true)`,
      tenantId,
      userId,
      role,
    );
    return work(transaction as unknown as PrismaClient);
  });
}

async function rejects(work: () => Promise<unknown>) {
  await assert.rejects(work);
}

async function seedFixture(client: PrismaClient) {
  await execute(
    client,
    `INSERT INTO tenant_memberships (id, tenant_id, user_id, role, status)
     VALUES
       ('00000000-0000-7000-8000-000000000104', $1::uuid, 'admin-a', 'admin', 'active'),
       ('00000000-0000-7000-8000-000000000105', $1::uuid, 'staff-a', 'staff', 'active'),
       ('00000000-0000-7000-8000-000000000106', $1::uuid, 'guardian-a2', 'guardian', 'active')
     ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status`,
    tenantA,
  );
  await execute(
    client,
    `INSERT INTO guardian_members (id, tenant_id, user_id, member_id, relationship)
     VALUES ('00000000-0000-7000-8000-000000000302', $1::uuid, 'guardian-a2', $2::uuid, '父')
     ON CONFLICT (tenant_id, user_id, member_id) DO NOTHING`,
    tenantA,
    memberA2,
  );

  await execute(
    client,
    `INSERT INTO attachments
       (id, tenant_id, owner_user_id, object_key, media_type, byte_size, sha256, status,
        expires_at, complete_attempts, cleanup_attempts, created_at, available_at)
     VALUES
       ($1::uuid, $3::uuid, 'guardian-a', 'tenant-a/00000000-0000-7000-8000-000000000501', 'image/png', 8,
        NULL, 'uploaded', '2099-01-01T00:00:00Z', 0, 0, now(), NULL),
       ($2::uuid, $4::uuid, 'owner-b', 'tenant-b/00000000-0000-7000-8000-000000000502', 'application/pdf', 5,
        NULL, 'uploaded', '2099-01-01T00:00:00Z', 0, 0, now(), NULL)`,
    attachmentA,
    attachmentB,
    tenantA,
    tenantB,
  );
  await execute(
    client,
    `UPDATE attachments
        SET status = 'available',
            sha256 = CASE WHEN id = $1::uuid THEN repeat('a', 64) ELSE repeat('b', 64) END,
            available_at = now()
      WHERE id IN ($1::uuid, $2::uuid)`,
    attachmentA,
    attachmentB,
  );
  await execute(
    client,
    `INSERT INTO events
       (id, tenant_id, title, event_type, starts_at, ends_at, attendance_deadline,
        announcement_image_attachment_id, created_by_user_id, updated_by_user_id)
     VALUES
       ($1::uuid, $3::uuid, 'テナントA予定', 'practice', '2099-02-01T10:00:00Z', '2099-02-01T12:00:00Z',
        '2099-02-01T09:00:00Z', $5::uuid, 'owner-a', 'owner-a'),
       ($2::uuid, $4::uuid, 'テナントB予定', 'practice', '2099-02-01T10:00:00Z', '2099-02-01T12:00:00Z',
        '2099-02-01T09:00:00Z', NULL, 'owner-b', 'owner-b')`,
    eventA,
    eventB,
    tenantA,
    tenantB,
    attachmentA,
  );
  await execute(
    client,
    `INSERT INTO attendance_responses
       (id, tenant_id, event_id, user_id, member_id, response)
     VALUES
       ('00000000-0000-7000-8000-000000000411', $1::uuid, $2::uuid, 'guardian-a', $3::uuid, 'attending'),
       ('00000000-0000-7000-8000-000000000412', $1::uuid, $2::uuid, 'owner-a', $4::uuid, 'absent')`,
    tenantA,
    eventA,
    memberA,
    memberA2,
  );
  await execute(
    client,
    `INSERT INTO board_contacts
       (id, tenant_id, fiscal_year, role_name, role_type, assignee_user_id, line_contact, phone, contact_preference)
     VALUES ($1::uuid, $2::uuid, 2099, '代表', 'admin', 'admin-a', 'line-contact-a', '090-0000-0000', 'both')`,
    boardContactA,
    tenantA,
  );
  await execute(
    client,
    `INSERT INTO purchase_orders (id, tenant_id, title, deadline, status)
     VALUES ($1::uuid, $2::uuid, 'テスト購買', '2099-03-01T00:00:00Z', 'open')`,
    orderA,
    tenantA,
  );
  await execute(
    client,
    `INSERT INTO order_products
       (id, tenant_id, order_id, name, unit_price, options, requires_back_number, requires_back_name)
     VALUES ($1::uuid, $2::uuid, $3::uuid, '練習着', 1000, '[{"name":"size","values":["M"]}]'::jsonb, false, false)`,
    productA,
    tenantA,
    orderA,
  );
  await client.$transaction(async (transaction) => {
    await execute(
      transaction as unknown as PrismaClient,
      `INSERT INTO order_entries
         (id, tenant_id, order_id, orderer_user_id, orderer_name, member_id, total_amount, payment_status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'guardian-a', '注文者A', $4::uuid, 1000, 'unpaid')`,
      entryA,
      tenantA,
      orderA,
      memberA,
    );
    await execute(
      transaction as unknown as PrismaClient,
      `INSERT INTO order_lines
         (id, tenant_id, order_entry_id, product_id, product_name, unit_price, quantity, selected_options, amount)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, '練習着', 1000, 1, '{"size":"M"}'::jsonb, 1000)`,
      lineA,
      tenantA,
      entryA,
      productA,
    );
  });
  await execute(
    client,
    `INSERT INTO order_idempotency_keys
       (id, tenant_id, actor_user_id, idempotency_key, request_hash, resource_type, resource_id)
     VALUES ($1::uuid, $2::uuid, 'guardian-a', 'fixture-key', repeat('c', 64), 'order_entry', $3::uuid)`,
    idempotencyA,
    tenantA,
    entryA,
  );
  await execute(
    client,
    `INSERT INTO announcements (id, tenant_id, author_user_id, title, body, status, published_at)
     VALUES ($1::uuid, $2::uuid, 'staff-a', '回覧A', '本文A', 'published', '2099-04-01T00:00:00Z')`,
    announcementA,
    tenantA,
  );
  await execute(
    client,
    `INSERT INTO announcement_attachments
       (tenant_id, announcement_id, attachment_id, position, media_type, byte_size)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 0, 'image/png', 8)`,
    tenantA,
    announcementA,
    attachmentA,
  );
  await execute(
    client,
    `INSERT INTO line_connections (tenant_id, group_id, status, connected_at)
     VALUES ($1::uuid, 'CcentralA', 'connected', '2099-05-01T00:00:00Z'),
            ($2::uuid, 'CcentralB', 'connected', '2099-05-01T00:00:00Z')
     ON CONFLICT (tenant_id) DO UPDATE SET group_id = EXCLUDED.group_id, status = EXCLUDED.status,
       connected_at = EXCLUDED.connected_at`,
    tenantA,
    tenantB,
  );
  const notificationRows = await rows<{ id: string }>(
    client,
    `INSERT INTO line_notification_queue
       (tenant_id, group_id, created_by_user_id, source_type, source_id, title, body, deep_link, status)
     VALUES ($1::uuid, 'CcentralA', 'staff-a', 'event', $2::uuid, '予定通知', '本文', 'https://example.test/events/fixture', 'pending')
     RETURNING id`,
    tenantA,
    eventA,
  );
  notificationA = notificationRows[0]?.id ?? '';
  assert.match(notificationA, /^[0-9a-f-]{36}$/);
  const notificationUuidRows = await rows<{ is_uuidv7: boolean }>(
    client,
    `SELECT app_is_uuidv7($1::uuid) AS is_uuidv7`,
    notificationA,
  );
  assert.equal(notificationUuidRows[0]?.is_uuidv7, true);
  await execute(
    client,
    `INSERT INTO line_webhook_receipts (tenant_id, group_id, webhook_event_id, received_at)
     VALUES ($1::uuid, 'CcentralA', 'webhook-fixture', '2099-05-01T00:00:00Z')`,
    tenantA,
  );
  await execute(
    client,
    `INSERT INTO ride_plans (id, tenant_id, title, departure_at, status)
     VALUES ($1::uuid, $2::uuid, '送迎A', '2099-06-01T08:00:00Z', 'open')`,
    ridePlanA,
    tenantA,
  );
  await execute(
    client,
    `INSERT INTO ride_offers (id, tenant_id, plan_id, driver_user_id, capacity, status)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'staff-a', 4, 'open')`,
    rideOfferA,
    tenantA,
    ridePlanA,
  );
  await execute(
    client,
    `INSERT INTO ride_requests (id, tenant_id, plan_id, member_id, requester_user_id, passenger_count, status)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'guardian-a', 1, 'pending')`,
    rideRequestA,
    tenantA,
    ridePlanA,
    memberA,
  );
  await execute(
    client,
    `INSERT INTO ride_assignments (id, tenant_id, plan_id, request_id, offer_id, passenger_count)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 1)`,
    rideAssignmentA,
    tenantA,
    ridePlanA,
    rideRequestA,
    rideOfferA,
  );
  await execute(
    client,
    `INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
     VALUES ($1::uuid, $2::uuid, 'admin-a', 'board_contact.update', 'board_contact', $3::uuid, '{"hasPhone":true}'::jsonb)`,
    auditA,
    tenantA,
    boardContactA,
  );
}

async function cleanupFixture(client: PrismaClient) {
  await client.$transaction(async (transaction) => {
    const tx = transaction as unknown as PrismaClient;
    await execute(
      tx,
      `DELETE FROM ride_assignments WHERE id = $1::uuid`,
      rideAssignmentA,
    );
    await execute(
      tx,
      `DELETE FROM ride_requests WHERE id = $1::uuid`,
      rideRequestA,
    );
    await execute(
      tx,
      `DELETE FROM ride_offers WHERE id = $1::uuid`,
      rideOfferA,
    );
    await execute(tx, `DELETE FROM ride_plans WHERE id = $1::uuid`, ridePlanA);
    if (notificationA) {
      await execute(
        tx,
        `DELETE FROM line_notification_queue WHERE id = $1::uuid`,
        notificationA,
      );
    }
    await execute(
      tx,
      `DELETE FROM line_webhook_receipts WHERE group_id = 'CcentralA'`,
    );
    await execute(
      tx,
      `DELETE FROM line_connections WHERE tenant_id IN ($1::uuid, $2::uuid)`,
      tenantA,
      tenantB,
    );
    await execute(
      tx,
      `DELETE FROM announcement_reads WHERE announcement_id = $1::uuid`,
      announcementA,
    );
    await execute(
      tx,
      `DELETE FROM announcement_attachments WHERE announcement_id = $1::uuid`,
      announcementA,
    );
    await execute(
      tx,
      `DELETE FROM announcements WHERE id = $1::uuid`,
      announcementA,
    );
    // 注文明細を先に消すと合計不一致になるため、fixture削除中だけ遅延検証を止める。
    await execute(
      tx,
      `ALTER TABLE order_entries DISABLE TRIGGER order_entries_total_guard`,
    );
    await execute(
      tx,
      `ALTER TABLE order_lines DISABLE TRIGGER order_lines_total_guard`,
    );
    await execute(tx, `DELETE FROM order_lines WHERE id = $1::uuid`, lineA);
    await execute(tx, `DELETE FROM order_entries WHERE id = $1::uuid`, entryA);
    await execute(
      tx,
      `ALTER TABLE order_lines ENABLE TRIGGER order_lines_total_guard`,
    );
    await execute(
      tx,
      `ALTER TABLE order_entries ENABLE TRIGGER order_entries_total_guard`,
    );
    await execute(
      tx,
      `DELETE FROM order_idempotency_keys WHERE id = $1::uuid`,
      idempotencyA,
    );
    await execute(
      tx,
      `DELETE FROM order_products WHERE id = $1::uuid`,
      productA,
    );
    await execute(
      tx,
      `DELETE FROM purchase_orders WHERE id = $1::uuid`,
      orderA,
    );
    await execute(
      tx,
      `DELETE FROM board_contacts WHERE id = $1::uuid`,
      boardContactA,
    );
    await execute(
      tx,
      `DELETE FROM attendance_responses WHERE event_id IN ($1::uuid, $2::uuid)`,
      eventA,
      eventB,
    );
    await execute(
      tx,
      `DELETE FROM events WHERE id IN ($1::uuid, $2::uuid)`,
      eventA,
      eventB,
    );
    await execute(
      tx,
      `DELETE FROM attachments WHERE id IN ($1::uuid, $2::uuid)`,
      attachmentA,
      attachmentB,
    );
    // 監査ログは本番契約で追記専用のため、fixture cleanupだけtriggerを一時停止する。
    await execute(
      tx,
      `ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only_guard`,
    );
    await execute(tx, `DELETE FROM audit_logs WHERE id = $1::uuid`, auditA);
    await execute(
      tx,
      `ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only_guard`,
    );
    await execute(
      tx,
      `DELETE FROM guardian_members WHERE user_id = 'guardian-a2' AND tenant_id = $1::uuid`,
      tenantA,
    );
    await execute(
      tx,
      `DELETE FROM tenant_memberships WHERE user_id IN ('admin-a', 'staff-a', 'guardian-a2') AND tenant_id = $1::uuid`,
      tenantA,
    );
  });
}

test('中央機能のRLSはtenant、role、担当部員、状態遷移をDBで強制する', {
  skip: !enabled,
}, async () => {
  app = new PrismaClient({ datasources: { db: { url: appUrl } } });
  direct = new PrismaClient({ datasources: { db: { url: directUrl } } });
  await cleanupFixture(direct);
  await seedFixture(direct);

  const identity = await rows<{ current_user: string; rolbypassrls: boolean }>(
    app,
    `SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
  );
  assert.equal(identity[0]?.current_user, 'cocolo_app');
  assert.equal(identity[0]?.rolbypassrls, false);

  const tables = [
    'events',
    'attendance_responses',
    'board_contacts',
    'purchase_orders',
    'order_products',
    'order_entries',
    'order_lines',
    'order_idempotency_keys',
    'attachments',
    'announcements',
    'announcement_reads',
    'line_connections',
    'line_notification_queue',
    'line_webhook_receipts',
    'ride_plans',
    'ride_offers',
    'ride_requests',
    'ride_assignments',
  ];
  for (const table of tables) {
    const privilege = await rows<{ allowed: boolean }>(
      app,
      `SELECT has_table_privilege(current_user, $1, 'SELECT') AS allowed`,
      table,
    );
    assert.equal(privilege[0]?.allowed, true, `${table}のSELECT grant`);
  }

  await withContext(app, tenantA, 'owner-a', 'owner', async (tx) => {
    assert.equal(await count(tx, 'events'), 1);
    assert.equal(await count(tx, 'attendance_responses'), 2);
    assert.equal(await count(tx, 'board_contacts'), 1);
    assert.equal(await count(tx, 'purchase_orders'), 1);
    assert.equal(await count(tx, 'attachments'), 1);
    assert.equal(await count(tx, 'announcements'), 1);
    assert.equal(await count(tx, 'line_notification_queue'), 1);
    assert.equal(await count(tx, 'ride_assignments'), 1);
    assert.equal(await count(tx, 'line_webhook_receipts'), 1);
    assert.equal(await count(tx, 'audit_logs'), 1);
    assert.equal(
      (
        await rows<{ phone: string; metadata: string }>(
          tx,
          `SELECT phone, (SELECT metadata::text FROM audit_logs WHERE id = $1::uuid) AS metadata
             FROM board_contacts WHERE id = $2::uuid`,
          auditA,
          boardContactA,
        )
      )[0]?.metadata.includes('090-'),
      false,
    );
  });

  await withContext(app, tenantB, 'owner-b', 'owner', async (tx) => {
    assert.equal(await count(tx, 'events'), 1);
    assert.equal(await count(tx, 'attachments'), 1);
    assert.equal(await count(tx, 'line_connections'), 1);
    assert.equal(await count(tx, 'purchase_orders'), 0);
  });

  await withContext(app, tenantA, 'guardian-a', 'guardian', async (tx) => {
    assert.equal(await count(tx, 'attendance_responses'), 1);
    assert.equal(await count(tx, 'attachments'), 1);
    assert.equal(await count(tx, 'order_entries'), 1);
    assert.equal(await count(tx, 'ride_requests'), 1);
    assert.equal(await count(tx, 'ride_assignments'), 1);
    assert.equal(await count(tx, 'line_notification_queue'), 0);
    await rejects(() =>
      execute(
        tx,
        `INSERT INTO attendance_responses
             (id, tenant_id, event_id, user_id, member_id, response)
           VALUES ('00000000-0000-7000-8000-000000000413', $1::uuid, $2::uuid, 'guardian-a', $3::uuid, 'absent')`,
        tenantA,
        eventA,
        memberA2,
      ),
    );
  });

  await withContext(app, tenantA, 'staff-a', 'staff', async (tx) => {
    assert.equal(await count(tx, 'board_contacts'), 1);
    assert.equal(await count(tx, 'events'), 1);
    assert.equal(await count(tx, 'purchase_orders'), 0);
  });

  await withContext(app, tenantA, 'guardian-a', 'guardian', async (tx) => {
    await execute(
      tx,
      `DELETE FROM board_contacts WHERE id = $1::uuid`,
      boardContactA,
    );
    assert.equal(await count(tx, 'board_contacts'), 1);
  });

  await withContext(app, tenantA, 'owner-a', 'owner', async (tx) => {
    await rejects(() =>
      execute(
        tx,
        `UPDATE purchase_orders SET status = 'completed' WHERE id = $1::uuid`,
        orderA,
      ),
    );
    await rejects(() =>
      execute(
        tx,
        `UPDATE attachments SET status = 'uploaded', deleted_at = NULL WHERE id = $1::uuid`,
        attachmentA,
      ),
    );
    await rejects(() =>
      execute(
        tx,
        `UPDATE line_notification_queue SET status = 'sent', sent_at = now() WHERE id = $1::uuid`,
        notificationA,
      ),
    );
    await rejects(() =>
      execute(
        tx,
        `UPDATE audit_logs SET action = 'tampered' WHERE id = $1::uuid`,
        auditA,
      ),
    );
    await rejects(() =>
      execute(
        tx,
        `INSERT INTO events
             (id, tenant_id, title, event_type, starts_at, ends_at, attendance_deadline, announcement_image_attachment_id, created_by_user_id, updated_by_user_id)
           VALUES ('00000000-0000-7000-8000-000000000499', $1::uuid, '越境', 'practice', '2099-02-01T10:00:00Z', '2099-02-01T12:00:00Z', '2099-02-01T09:00:00Z', $2::uuid, 'owner-a', 'owner-a')`,
        tenantA,
        attachmentB,
      ),
    );
  });

  const noContext = await app.$transaction(async (tx) => {
    await execute(
      tx as unknown as PrismaClient,
      `SELECT set_config('app.tenant_id', '', true), set_config('app.user_id', '', true), set_config('app.role', '', true)`,
    );
    return Promise.all([
      count(tx as unknown as PrismaClient, 'events'),
      count(tx as unknown as PrismaClient, 'attachments'),
    ]);
  });
  assert.deepEqual(noContext, [0, 0]);
});

after(async () => {
  if (direct) await cleanupFixture(direct);
  await app?.$disconnect();
  await direct?.$disconnect();
});
