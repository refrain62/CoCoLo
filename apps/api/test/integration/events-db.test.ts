import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createPrismaClient } from '@cocolo/db/client';
import { createEventRepository } from '@cocolo/db/events';
import { AttendancePolicyError } from '@cocolo/domain/event';

const TENANT_A = '00000000-0000-7000-8000-000000000001';
const TENANT_B = '00000000-0000-7000-8000-000000000002';
const MEMBER_A = '00000000-0000-7000-8000-000000000201';

assert.ok(process.env.DATABASE_URL, 'DATABASE_URLが必要です');
const prisma = createPrismaClient();
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
  const secondGuardian = await repository.upsertAttendance({
    tenantId: TENANT_A,
    actorUserId: 'guardian-a2',
    role: 'guardian',
    eventId: created.id,
    memberId: MEMBER_A,
    response: 'absent',
  });
  assert.notEqual(first.id, secondGuardian.id);
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
  assert.equal(summary.totalMembers, 2);
  assert.equal(summary.unanswered, 1);
});

test('実DBの同時初回回答はatomic upsertで一意行へ収束する', async () => {
  const created = await repository.create({
    tenantId: TENANT_A,
    actorUserId: 'owner-a',
    role: 'owner',
    ...eventInput(`concurrent-${Date.now()}`),
  });

  const results = await Promise.all([
    repository.upsertAttendance({
      tenantId: TENANT_A,
      actorUserId: 'owner-a',
      role: 'owner',
      eventId: created.id,
      memberId: MEMBER_A,
      response: 'attending',
    }),
    repository.upsertAttendance({
      tenantId: TENANT_A,
      actorUserId: 'owner-a',
      role: 'owner',
      eventId: created.id,
      memberId: MEMBER_A,
      response: 'absent',
    }),
  ]);

  assert.equal(results[0]?.id, results[1]?.id);
  const summary = await repository.summary({
    tenantId: TENANT_A,
    actorUserId: 'owner-a',
    role: 'owner',
    eventId: created.id,
  });
  assert.equal(summary.totalMembers, 2);
  assert.equal(summary.unanswered, 1);
  assert.equal(summary.attending + summary.absent + summary.pending, 1);
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

test.after(async () => {
  await prisma.$disconnect();
});
