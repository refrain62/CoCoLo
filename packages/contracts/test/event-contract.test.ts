import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attendanceUpsertSchema,
  eventCreateSchema,
  eventListQuerySchema,
  eventUpdateSchema,
} from '../src/event-contract.ts';

const validEvent = {
  title: '練習',
  type: 'practice',
  startsAt: '2026-09-01T10:00:00Z',
  endsAt: '2026-09-01T12:00:00Z',
  attendanceDeadline: '2026-08-31T10:00:00Z',
  fee: 0,
  transportationRequired: false,
};

test('予定契約はtenantIdを入力させず、時刻関係を検証する', () => {
  assert.equal(eventCreateSchema.safeParse(validEvent).success, true);
  assert.equal(
    eventCreateSchema.safeParse({ ...validEvent, tenantId: 'tenant-a' })
      .success,
    false,
  );
  assert.equal(
    eventCreateSchema.safeParse({
      ...validEvent,
      endsAt: '2026-09-01T09:00:00Z',
    }).success,
    false,
  );
});

test('試合の対戦相手と締切後修正理由は別のAPI契約で検証する', () => {
  assert.equal(
    eventCreateSchema.safeParse({ ...validEvent, type: 'match' }).success,
    false,
  );
  assert.equal(eventUpdateSchema.safeParse({ title: '更新' }).success, true);
  assert.equal(eventUpdateSchema.safeParse({}).success, false);
  assert.equal(
    attendanceUpsertSchema.safeParse({
      memberId: '00000000-0000-7000-8000-000000000201',
      response: 'attending',
      unexpected: true,
    }).success,
    false,
  );
});

test('予定一覧の検索期間は93日以内に制限する', () => {
  assert.equal(
    eventListQuerySchema.safeParse({
      from: '2026-01-01T00:00:00Z',
      to: '2026-04-04T00:00:00Z',
    }).success,
    true,
  );
  assert.equal(
    eventListQuerySchema.safeParse({
      from: '2026-01-01T00:00:00Z',
      to: '2026-04-05T00:00:00Z',
    }).success,
    false,
  );
});
