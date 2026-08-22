import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAttendanceChangeAllowed,
  assertValidEventSchedule,
  summarizeAttendance,
} from '../dist/event-domain.js';

const schedule = {
  startsAt: new Date('2026-09-01T10:00:00Z'),
  endsAt: new Date('2026-09-01T12:00:00Z'),
  attendanceDeadline: new Date('2026-08-31T10:00:00Z'),
};

test('予定は終了時刻と締切の前後関係を保証する', () => {
  assert.doesNotThrow(() => assertValidEventSchedule(schedule, 'practice'));
  assert.throws(
    () =>
      assertValidEventSchedule(
        { ...schedule, endsAt: schedule.startsAt },
        'practice',
      ),
    /終了時刻/,
  );
  assert.throws(
    () =>
      assertValidEventSchedule(
        { ...schedule, attendanceDeadline: new Date('2026-09-01T11:00:00Z') },
        'practice',
      ),
    /締切/,
  );
});

test('試合には対戦相手を要求する', () => {
  assert.throws(() => assertValidEventSchedule(schedule, 'match'), /対戦相手/);
});

test('guardianは担当部員の締切前回答だけを変更できる', () => {
  assert.doesNotThrow(() =>
    assertAttendanceChangeAllowed({
      role: 'guardian',
      isAssignedMember: true,
      deadlinePassed: false,
    }),
  );
  assert.throws(
    () =>
      assertAttendanceChangeAllowed({
        role: 'guardian',
        isAssignedMember: true,
        deadlinePassed: true,
      }),
    /締切後/,
  );
  assert.throws(
    () =>
      assertAttendanceChangeAllowed({
        role: 'guardian',
        isAssignedMember: false,
        deadlinePassed: false,
      }),
    /担当部員/,
  );
});

test('締切後の管理者修正は理由を要求する', () => {
  assert.throws(
    () =>
      assertAttendanceChangeAllowed({
        role: 'staff',
        isAssignedMember: false,
        deadlinePassed: true,
      }),
    /理由/,
  );
  assert.doesNotThrow(() =>
    assertAttendanceChangeAllowed({
      role: 'admin',
      isAssignedMember: false,
      deadlinePassed: true,
      correctionReason: '大会日程の変更を反映',
    }),
  );
});

test('回答件数と未回答件数を集計する', () => {
  assert.deepEqual(
    summarizeAttendance(4, ['attending', 'absent', 'attending']),
    { attending: 2, absent: 1, pending: 0, unanswered: 1 },
  );
});
