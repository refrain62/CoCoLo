export type EventType = 'practice' | 'match' | 'event';
export type AttendanceResponse = 'attending' | 'absent' | 'pending';
export type EventRole = 'owner' | 'admin' | 'staff' | 'guardian';

export type EventSchedule = {
  startsAt: Date;
  endsAt: Date;
  attendanceDeadline: Date;
  meetingTime?: Date | null;
};

export class EventScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventScheduleError';
  }
}

// 保存前に予定の時間関係を検証し、締切後の出欠判定が曖昧にならない値だけを受け入れる。
export function assertValidEventSchedule(
  schedule: EventSchedule,
  type: EventType,
  opponent?: string | null,
) {
  if (schedule.endsAt <= schedule.startsAt)
    throw new EventScheduleError(
      '終了時刻は開始時刻より後でなければなりません。',
    );
  if (schedule.attendanceDeadline > schedule.startsAt)
    throw new EventScheduleError(
      '出欠締切は開始時刻以前でなければなりません。',
    );
  if (schedule.meetingTime && schedule.meetingTime > schedule.startsAt)
    throw new EventScheduleError(
      '集合時刻は開始時刻以前でなければなりません。',
    );
  if (type === 'match' && !opponent?.trim())
    throw new EventScheduleError('試合には対戦相手が必要です。');
}

export function canManageEvents(role: EventRole) {
  return role === 'owner' || role === 'admin' || role === 'staff';
}

export function canManageAttendance(role: EventRole) {
  return canManageEvents(role);
}

export function assertAttendanceChangeAllowed(input: {
  role: EventRole;
  isAssignedMember: boolean;
  deadlinePassed: boolean;
  correctionReason?: string | null;
}) {
  if (input.role === 'guardian' && !input.isAssignedMember)
    throw new Error('担当部員の出欠だけを変更できます。');
  if (input.role === 'guardian' && input.deadlinePassed)
    throw new Error('出欠締切後は回答を変更できません。');
  if (canManageAttendance(input.role) && input.deadlinePassed) {
    if (!input.correctionReason?.trim())
      throw new Error('締切後の管理者修正には理由が必要です。');
  }
  if (!canManageAttendance(input.role) && input.role !== 'guardian')
    throw new Error('出欠を変更する権限がありません。');
}

export type AttendanceCount = {
  attending: number;
  absent: number;
  pending: number;
  unanswered: number;
};

// 回答一覧を件数へ集約し、未回答をpendingとして扱う集計規則を一箇所に固定する。
export function summarizeAttendance(
  totalMembers: number,
  responses: AttendanceResponse[],
): AttendanceCount {
  const count: AttendanceCount = {
    attending: 0,
    absent: 0,
    pending: 0,
    unanswered: Math.max(0, totalMembers - responses.length),
  };
  for (const response of responses) count[response] += 1;
  return count;
}
