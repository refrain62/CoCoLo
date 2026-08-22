import { type FormEvent, useEffect, useState } from 'react';
import {
  type AttendanceResponse,
  type AttendanceSummary,
  type EventRole,
  type EventSummary,
  type EventsApi,
  EventsApiError,
  type EventUpdateInput,
} from './events-api.js';
import './events.css';

type MemberOption = { id: string; name: string };
type AnswerState = 'unanswered' | 'saving' | 'saved' | 'error';

const typeLabels: Record<EventSummary['type'], string> = {
  practice: '練習',
  match: '試合',
  event: 'イベント',
};

const responseLabels: Record<AttendanceResponse, string> = {
  attending: '参加',
  absent: '欠席',
  pending: '未定',
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
}

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function canManage(role: EventRole) {
  return role === 'owner' || role === 'admin' || role === 'staff';
}

function isDeadlinePassed(event: EventSummary) {
  return Date.parse(event.attendanceDeadline) <= Date.now();
}

function errorMessage(error: unknown, fallback: string) {
  if (!(error instanceof EventsApiError)) return fallback;
  if (error.code === 'ATTENDANCE_DEADLINE_PASSED')
    return '出欠締切後のため、回答を保存できません。';
  if (error.code === 'CORRECTION_REASON_REQUIRED')
    return '締切後の管理者修正には理由が必要です。';
  return error.message;
}

function parseDateTimeLocal(value: string, label: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label}が不正です。`);
  return date.toISOString();
}

function answerStatusMessage(
  state: AnswerState,
  savedResponse: AttendanceResponse | null,
  error: string | null,
) {
  if (state === 'unanswered') return '回答状態: 未回答';
  if (state === 'saving') return '保存中…';
  if (state === 'error') return error ?? '出欠の保存に失敗しました。';
  return `回答状態: 保存済み（${savedResponse ? responseLabels[savedResponse] : '未定'}）`;
}

function AttendanceSummaryView({ summary }: { summary: AttendanceSummary }) {
  return (
    <dl aria-label="出欠集計">
      <dt>対象部員</dt>
      <dd>{summary.totalMembers}名</dd>
      <dt>参加</dt>
      <dd>{summary.attending}名</dd>
      <dt>欠席</dt>
      <dd>{summary.absent}名</dd>
      <dt>未定</dt>
      <dd>{summary.pending}名</dd>
      <dt>未回答</dt>
      <dd>{summary.unanswered}名</dd>
    </dl>
  );
}

// 詳細画面で回答対象・締切・管理者権限を同じAPI契約へ接続し、通知リンクから操作を完了できるようにする。
export function EventDetailView({
  api,
  event,
  role,
  memberOptions,
  onEventUpdated,
}: {
  api: EventsApi;
  event: EventSummary;
  role: EventRole;
  memberOptions: MemberOption[];
  onEventUpdated?: (event: EventSummary) => void;
}) {
  const [displayEvent, setDisplayEvent] = useState(event);
  const [memberId, setMemberId] = useState(memberOptions[0]?.id ?? '');
  const [response, setResponse] = useState<AttendanceResponse>('pending');
  const [savedResponse, setSavedResponse] = useState<AttendanceResponse | null>(
    null,
  );
  const [answerState, setAnswerState] = useState<AnswerState>('unanswered');
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [summaryState, setSummaryState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(event.title);
  const [editStartsAt, setEditStartsAt] = useState(
    toDateTimeLocal(event.startsAt),
  );
  const [editEndsAt, setEditEndsAt] = useState(toDateTimeLocal(event.endsAt));
  const [editDeadline, setEditDeadline] = useState(
    toDateTimeLocal(event.attendanceDeadline),
  );
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayEvent(event);
    setEditTitle(event.title);
    setEditStartsAt(toDateTimeLocal(event.startsAt));
    setEditEndsAt(toDateTimeLocal(event.endsAt));
    setEditDeadline(toDateTimeLocal(event.attendanceDeadline));
  }, [event]);

  useEffect(() => {
    if (!memberOptions.some((member) => member.id === memberId))
      setMemberId(memberOptions[0]?.id ?? '');
  }, [memberId, memberOptions]);

  const deadlinePassed = isDeadlinePassed(displayEvent);
  const isAnswerSaving = answerState === 'saving';

  async function answer(eventSubmit: FormEvent<HTMLFormElement>) {
    eventSubmit.preventDefault();
    if (!memberId) return;
    setAnswerState('saving');
    setAnswerError(null);
    try {
      const result = await api.answer(displayEvent.id, {
        memberId,
        response,
        ...(correctionReason.trim()
          ? { correctionReason: correctionReason.trim() }
          : {}),
      });
      setSavedResponse(result.response);
      setResponse(result.response);
      setAnswerState('saved');
      setSummary(null);
      setSummaryState('idle');
    } catch (error) {
      setAnswerState('error');
      setAnswerError(errorMessage(error, '出欠の保存に失敗しました。'));
    }
  }

  async function loadSummary() {
    setSummaryState('loading');
    setSummaryError(null);
    try {
      setSummary(await api.summary(displayEvent.id));
      setSummaryState('ready');
    } catch (error) {
      setSummaryState('error');
      setSummaryError(errorMessage(error, '出欠集計の取得に失敗しました。'));
    }
  }

  async function updateEvent(eventSubmit: FormEvent<HTMLFormElement>) {
    eventSubmit.preventDefault();
    setIsUpdating(true);
    setUpdateError(null);
    try {
      const input: EventUpdateInput = {
        title: editTitle.trim(),
        startsAt: parseDateTimeLocal(editStartsAt, '開始時刻'),
        endsAt: parseDateTimeLocal(editEndsAt, '終了時刻'),
        attendanceDeadline: parseDateTimeLocal(editDeadline, '出欠締切'),
      };
      const updated = await api.update(displayEvent.id, input);
      setDisplayEvent(updated);
      onEventUpdated?.(updated);
      setIsEditing(false);
    } catch (error) {
      setUpdateError(errorMessage(error, '予定の更新に失敗しました。'));
    } finally {
      setIsUpdating(false);
    }
  }

  return (
    <section aria-labelledby="event-detail-heading">
      <p>
        <a href="/events">予定一覧へ戻る</a>
      </p>
      <header>
        <p className="event-type">{typeLabels[displayEvent.type]}</p>
        <h1 id="event-detail-heading">{displayEvent.title}</h1>
      </header>
      <dl>
        <dt>開始</dt>
        <dd>{formatDate(displayEvent.startsAt)}</dd>
        <dt>終了</dt>
        <dd>{formatDate(displayEvent.endsAt)}</dd>
        <dt>出欠締切</dt>
        <dd>{formatDate(displayEvent.attendanceDeadline)}</dd>
        <dt>場所</dt>
        <dd>{displayEvent.location ?? '未設定'}</dd>
        <dt>持ち物</dt>
        <dd>{displayEvent.itemsToBring ?? '未設定'}</dd>
        <dt>会費</dt>
        <dd>{displayEvent.fee.toLocaleString('ja-JP')}円</dd>
        <dt>対戦相手</dt>
        <dd>{displayEvent.opponent ?? '該当なし'}</dd>
        <dt>集合時刻</dt>
        <dd>
          {displayEvent.meetingTime
            ? formatDate(displayEvent.meetingTime)
            : '未設定'}
        </dd>
        <dt>配車</dt>
        <dd>{displayEvent.transportationRequired ? '必要' : '不要'}</dd>
      </dl>

      {canManage(role) ? (
        <section aria-labelledby="event-management-heading">
          <h2 id="event-management-heading">予定の管理</h2>
          <button
            type="button"
            onClick={() => {
              setUpdateError(null);
              setIsEditing((current) => !current);
            }}
          >
            {isEditing ? '編集を閉じる' : '予定を編集'}
          </button>
          {isEditing ? (
            <form onSubmit={updateEvent}>
              <label htmlFor="event-detail-edit-title">タイトル</label>
              <input
                id="event-detail-edit-title"
                value={editTitle}
                onChange={(input) => setEditTitle(input.target.value)}
                required
              />
              <label htmlFor="event-detail-edit-starts">開始</label>
              <input
                id="event-detail-edit-starts"
                type="datetime-local"
                value={editStartsAt}
                onChange={(input) => setEditStartsAt(input.target.value)}
                required
              />
              <label htmlFor="event-detail-edit-ends">終了</label>
              <input
                id="event-detail-edit-ends"
                type="datetime-local"
                value={editEndsAt}
                onChange={(input) => setEditEndsAt(input.target.value)}
                required
              />
              <label htmlFor="event-detail-edit-deadline">出欠締切</label>
              <input
                id="event-detail-edit-deadline"
                type="datetime-local"
                value={editDeadline}
                onChange={(input) => setEditDeadline(input.target.value)}
                required
              />
              <button type="submit" disabled={isUpdating}>
                {isUpdating ? '保存中…' : '予定を保存'}
              </button>
              {updateError ? <p role="alert">{updateError}</p> : null}
            </form>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="event-attendance-heading">
        <h2 id="event-attendance-heading">出欠回答</h2>
        {role === 'guardian' && deadlinePassed ? (
          <p role="alert">出欠締切後のため、回答を変更できません。</p>
        ) : null}
        {memberOptions.length === 0 ? (
          <p role="status">回答対象の担当部員がありません。</p>
        ) : (
          <form onSubmit={answer}>
            <fieldset disabled={isAnswerSaving}>
              <legend>回答対象と回答内容</legend>
              <label htmlFor="event-detail-member">部員</label>
              <select
                id="event-detail-member"
                value={memberId}
                onChange={(input) => setMemberId(input.target.value)}
              >
                {memberOptions.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
              <label htmlFor="event-detail-response">回答</label>
              <select
                id="event-detail-response"
                value={response}
                onChange={(input) => {
                  setAnswerError(null);
                  setResponse(input.target.value as AttendanceResponse);
                }}
              >
                {Object.entries(responseLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {canManage(role) && deadlinePassed ? (
                <label htmlFor="event-detail-correction-reason">
                  締切後の管理者修正理由（必須）
                  <input
                    id="event-detail-correction-reason"
                    value={correctionReason}
                    onChange={(input) =>
                      setCorrectionReason(input.target.value)
                    }
                    required
                  />
                </label>
              ) : null}
              <button
                type="submit"
                disabled={
                  isAnswerSaving ||
                  !memberId ||
                  (role === 'guardian' && deadlinePassed)
                }
              >
                {isAnswerSaving ? '保存中…' : '出欠を保存'}
              </button>
            </fieldset>
          </form>
        )}
        <p role={answerState === 'error' ? 'alert' : 'status'}>
          {answerStatusMessage(answerState, savedResponse, answerError)}
        </p>
      </section>

      {canManage(role) ? (
        <section aria-labelledby="event-summary-heading">
          <h2 id="event-summary-heading">出欠集計</h2>
          <button
            type="button"
            onClick={() => void loadSummary()}
            disabled={summaryState === 'loading'}
          >
            {summaryState === 'loading' ? '集計中…' : '出欠を集計'}
          </button>
          {summaryState === 'loading' ? (
            <p role="status">出欠を集計中…</p>
          ) : null}
          {summaryState === 'error' && summaryError ? (
            <p role="alert">{summaryError}</p>
          ) : null}
          {summaryState === 'ready' && summary ? (
            <AttendanceSummaryView summary={summary} />
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

// URLから表示対象を固定し、一覧画面を経由しない通知リンクでも同じ認証APIで詳細を取得する。
export function EventDetailPage({
  api,
  eventId,
  role,
  memberOptions,
}: {
  api: EventsApi;
  eventId: string;
  role: EventRole;
  memberOptions: MemberOption[];
}) {
  const [event, setEvent] = useState<EventSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setEvent(null);
    setMessage(null);
    void api
      .get(eventId)
      .then((result) => {
        if (active) setEvent(result);
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(errorMessage(error, '予定詳細の読み込みに失敗しました。'));
      });
    return () => {
      active = false;
    };
  }, [api, eventId]);

  if (message)
    return (
      <section className="central-state" aria-labelledby="event-detail-error">
        <h1 id="event-detail-error">予定詳細</h1>
        <p role="alert">{message}</p>
        <a href="/events">予定一覧へ戻る</a>
      </section>
    );
  if (!event)
    return (
      <p className="central-state" role="status">
        予定詳細を読み込み中…
      </p>
    );

  return (
    <EventDetailView
      api={api}
      event={event}
      memberOptions={memberOptions}
      onEventUpdated={setEvent}
      role={role}
    />
  );
}
