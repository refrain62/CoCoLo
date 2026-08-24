import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createPrismaClient } from '@cocolo/db/client';
import { createEventRepository } from '@cocolo/db/events';
import { AttendancePolicyError } from '@cocolo/domain/event';

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const TENANT_B = '00000000-0000-7000-8000-000000000002';
const MEMBER_A = '00000000-0000-7000-8000-000000000201';
const EVENT_LINE_TENANT = '00000000-0000-7000-8000-000000001201';
const EVENT_LINE_MEMBERSHIP = '00000000-0000-7000-8000-000000001202';
const EVENT_LINE_ACTOR = 'event-line-owner';

assert.ok(process.env.DATABASE_URL, 'DATABASE_URLが必要です');
assert.ok(process.env.DIRECT_URL, 'DIRECT_URLが必要です');
const prisma = createPrismaClient();
const direct = createPrismaClient(process.env.DIRECT_URL);
const repository = createEventRepository(prisma);

function eventInput(suffix: string | number, late = false) {
  const startsAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  return {
    title: `統合テスト予定-${suffix}`,
    type: 'practice' as const,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000),
    location: '統合テスト会場',
    itemsToBring: '飲み物',
    fee: 500,
    transportationRequired: false,
    attendanceDeadline: late
      ? new Date(Date.now() - 60 * 60 * 1000)
      : new Date(startsAt.getTime() - 24 * 60 * 60 * 1000),
  };
}

test('実DBの予定・出欠repositoryがtenant境界と一意回答を守る', async () => {
  const created = await repository.create({
    tenantId: TENANT_A,
    actorUserId: 'owner-a',
    role: 'owner',
    ...eventInput(Date.now()),
  });
  assert.equal(created.tenantId, TENANT_A);

  const listed = await repository.list({
    tenantId: TENANT_A,
    actorUserId: 'owner-a',
    role: 'owner',
    from: new Date(Date.now() - 60 * 60 * 1000),
    to: new Date(Date.now() + 72 * 60 * 60 * 1000),
  });
  assert.equal(
    listed.some((event) => event.id === created.id),
    true,
  );
  assert.equal(
    listed.some((event) => event.tenantId === TENANT_B),
    false,
  );

  const first = await repository.upsertAttendance({
    tenantId: TENANT_A,
    actorUserId: 'guardian-a',
    role: 'guardian',
    eventId: created.id,
    memberId: MEMBER_A,
    response: 'attending',
  });
  const managerCorrection = await repository.upsertAttendance({
    tenantId: TENANT_A,
    actorUserId: 'owner-a',
    role: 'owner',
    eventId: created.id,
    memberId: MEMBER_A,
    response: 'absent',
  });
  assert.equal(managerCorrection.id, first.id);
  const second = await repository.upsertAttendance({
    tenantId: TENANT_A,
    actorUserId: 'guardian-a',
    role: 'guardian',
    eventId: created.id,
    memberId: MEMBER_A,
    response: 'absent',
  });
  assert.equal(first.id, second.id);
  assert.equal(second.response, 'absent');

  const summary = await repository.summary({
    tenantId: TENANT_A,
    actorUserId: 'owner-a',
    role: 'owner',
    eventId: created.id,
  });
  assert.equal(summary.absent, 1);
  assert.equal(summary.attending, 0);
});

test('実DBは締切後の管理者修正理由を要求する', async () => {
  const created = await repository.create({
    tenantId: TENANT_A,
    actorUserId: 'owner-a',
    role: 'owner',
    ...eventInput(`late-${Date.now()}`, true),
  });
  await assert.rejects(
    repository.upsertAttendance({
      tenantId: TENANT_A,
      actorUserId: 'owner-a',
      role: 'owner',
      eventId: created.id,
      memberId: MEMBER_A,
      response: 'attending',
    }),
    (error) =>
      error instanceof AttendancePolicyError &&
      error.code === 'CORRECTION_REASON_REQUIRED',
  );
  const corrected = await repository.upsertAttendance({
    tenantId: TENANT_A,
    actorUserId: 'owner-a',
    role: 'owner',
    eventId: created.id,
    memberId: MEMBER_A,
    response: 'attending',
    correctionReason: '日程変更を反映',
  });
  assert.equal(corrected.response, 'attending');
  assert.equal(corrected.correctionReason, '日程変更を反映');

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT
          set_config('app.tenant_id', ${TENANT_A}, true),
          set_config('app.user_id', 'owner-a', true),
          set_config('app.role', 'owner', true)
      `;
      await tx.$executeRaw`
        INSERT INTO attendance_responses
          (id, tenant_id, event_id, user_id, member_id, response)
        VALUES
          (${randomUUID()}::uuid, ${TENANT_A}::uuid, ${created.id}::uuid,
           'owner-a', ${MEMBER_A}::uuid, 'absent'::attendance_response)
      `;
    }),
    /締切後の管理者修正には理由が必要です/,
  );
});

test('予定の保存transactionがLINE outboxへ即時通知と締切通知を冪等登録する', async () => {
  const now = new Date(Date.now() - 60 * 1000);
  const notificationRepository = createEventRepository(prisma, {
    notificationPublicAppUrl: 'https://app.example.test/',
    now: () => now,
  });
  const groupId = `Cevt-${randomUUID()}`;
  const startsAt = new Date(now.getTime() + 96 * 60 * 60 * 1000);
  const attendanceDeadline = new Date(now.getTime() + 72 * 60 * 60 * 1000);
  await direct.$executeRaw`
    INSERT INTO tenants (id, name)
    VALUES (${EVENT_LINE_TENANT}::uuid, '予定LINE統合テスト')
    ON CONFLICT (id) DO NOTHING
  `;
  await direct.$executeRaw`
    INSERT INTO tenant_memberships (id, tenant_id, user_id, role, status)
    VALUES (
      ${EVENT_LINE_MEMBERSHIP}::uuid,
      ${EVENT_LINE_TENANT}::uuid,
      ${EVENT_LINE_ACTOR},
      'owner',
      'active'
    )
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET
      role = EXCLUDED.role,
      status = EXCLUDED.status
  `;
  await direct.$executeRaw`
    INSERT INTO line_connections (tenant_id, group_id, status, connected_at)
    VALUES (${EVENT_LINE_TENANT}::uuid, ${groupId}, 'connected', ${now})
    ON CONFLICT (tenant_id) DO UPDATE SET
      group_id = EXCLUDED.group_id,
      status = EXCLUDED.status,
      connected_at = EXCLUDED.connected_at
  `;
  let createdId: string | null = null;
  try {
    const created = await notificationRepository.create({
      tenantId: EVENT_LINE_TENANT,
      actorUserId: EVENT_LINE_ACTOR,
      role: 'owner',
      title: `LINE予定-${randomUUID()}`,
      type: 'practice',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000),
      fee: 0,
      transportationRequired: false,
      attendanceDeadline,
    });
    createdId = created.id;
    const firstRows = await direct.$queryRaw<
      Array<{
        id: string;
        source_type: string;
        destination: string;
        next_retry_at: Date | null;
        deep_link: string;
      }>
    >`
      SELECT id, source_type, destination, next_retry_at, deep_link
        FROM line_delivery_outbox
       WHERE tenant_id = ${EVENT_LINE_TENANT}::uuid AND source_id = ${created.id}
       ORDER BY source_type
    `;
    assert.equal(firstRows.length, 2);
    assert.deepEqual(
      firstRows.map((row) => row.source_type),
      ['deadline', 'event'],
    );
    const deadlineRow = firstRows.find((row) => row.source_type === 'deadline');
    const eventRow = firstRows.find((row) => row.source_type === 'event');
    assert.ok(eventRow?.id);
    assert.equal(eventRow?.destination, groupId);
    assert.equal(eventRow?.next_retry_at, null);
    assert.equal(
      deadlineRow?.next_retry_at?.toISOString(),
      new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
    );
    assert.equal(
      eventRow?.deep_link,
      `https://app.example.test/events/${created.id}`,
    );

    const uppercaseRows = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT
          set_config('app.tenant_id', ${EVENT_LINE_TENANT}, true),
          set_config('app.user_id', ${EVENT_LINE_ACTOR}, true),
          set_config('app.role', 'owner', true)
      `;
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT app_enqueue_event_line_delivery(
          ${'00000000-0000-7000-8000-000000001203'}::uuid,
          ${EVENT_LINE_TENANT}::uuid,
          ${EVENT_LINE_ACTOR},
          'event',
          ${created.id.toUpperCase()},
          ${groupId},
          '予定のお知らせ',
          '予定の詳細を確認してください。',
          ${`https://app.example.test/events/${created.id}`},
          ${`event:${created.id}`},
          ${now}
        ) AS id
      `;
    });
    assert.deepEqual(uppercaseRows, [{ id: eventRow.id }]);
    const disconnectedRows = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT
          set_config('app.tenant_id', ${EVENT_LINE_TENANT}, true),
          set_config('app.user_id', ${EVENT_LINE_ACTOR}, true),
          set_config('app.role', 'owner', true)
      `;
      return tx.$queryRaw<Array<{ id: string | null }>>`
        SELECT app_enqueue_event_line_delivery(
          ${'00000000-0000-7000-8000-000000001204'}::uuid,
          ${EVENT_LINE_TENANT}::uuid,
          ${EVENT_LINE_ACTOR},
          'event',
          ${created.id},
          ${`Cother-${randomUUID()}`},
          '予定のお知らせ',
          '予定の詳細を確認してください。',
          ${`https://app.example.test/events/${created.id}`},
          ${`event:${created.id}`},
          ${now}
        ) AS id
      `;
    });
    assert.deepEqual(disconnectedRows, [{ id: null }]);

    const nextGroupId = `Cevt-${randomUUID()}`;
    const nextConnectionGeneration = new Date();
    await direct.$executeRaw`
      UPDATE line_connections
         SET group_id = ${nextGroupId}, connected_at = ${nextConnectionGeneration}
       WHERE tenant_id = ${EVENT_LINE_TENANT}::uuid
    `;
    const updatedDeadline = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    await notificationRepository.update({
      tenantId: EVENT_LINE_TENANT,
      actorUserId: EVENT_LINE_ACTOR,
      role: 'owner',
      eventId: created.id,
      attendanceDeadline: updatedDeadline,
    });
    const secondRows = await direct.$queryRaw<
      Array<{
        id: string;
        source_type: string;
        destination: string;
        next_retry_at: Date | null;
      }>
    >`
      SELECT id, source_type, destination, next_retry_at
        FROM line_delivery_outbox
       WHERE tenant_id = ${EVENT_LINE_TENANT}::uuid AND source_id = ${created.id}
       ORDER BY source_type
    `;
    assert.equal(secondRows.length, 2);
    assert.deepEqual(
      secondRows.map((row) => row.id),
      firstRows.map((row) => row.id),
    );
    assert.deepEqual(
      secondRows.map((row) => row.destination),
      [nextGroupId, groupId],
    );
    assert.equal(
      secondRows
        .find((row) => row.source_type === 'deadline')
        ?.next_retry_at?.toISOString(),
      new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    );

    await direct.$executeRaw`
      UPDATE line_delivery_outbox
         SET status = 'sent', sent_at = ${now}
       WHERE tenant_id = ${EVENT_LINE_TENANT}::uuid
         AND source_type = 'deadline'
         AND source_id = ${created.id}
    `;
    await notificationRepository.update({
      tenantId: EVENT_LINE_TENANT,
      actorUserId: EVENT_LINE_ACTOR,
      role: 'owner',
      eventId: created.id,
      title: `更新後-${randomUUID()}`,
    });
    const sentRows = await direct.$queryRaw<
      Array<{ status: string; next_retry_at: Date | null }>
    >`
      SELECT status, next_retry_at
        FROM line_delivery_outbox
       WHERE tenant_id = ${EVENT_LINE_TENANT}::uuid
         AND source_type = 'deadline'
         AND source_id = ${created.id}
    `;
    assert.deepEqual(sentRows, [{ status: 'sent', next_retry_at: null }]);
  } finally {
    if (createdId)
      await direct.$executeRaw`
        DELETE FROM line_delivery_outbox
         WHERE tenant_id = ${EVENT_LINE_TENANT}::uuid AND source_id = ${createdId}
      `;
    if (createdId)
      await direct.$executeRaw`
        DELETE FROM events WHERE tenant_id = ${EVENT_LINE_TENANT}::uuid AND id = ${createdId}::uuid
      `;
    await direct.$executeRaw`
      DELETE FROM line_connections WHERE tenant_id = ${EVENT_LINE_TENANT}::uuid
    `;
  }
});

test.after(async () => {
  await direct.$disconnect();
  await prisma.$disconnect();
});
