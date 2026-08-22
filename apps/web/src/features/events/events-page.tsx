import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  type AttendanceResponse,
  createEventsApi,
  type EventRole,
  type EventSummary,
  type EventsApi,
  EventsApiError,
} from './events-api.js';
import './events.css';

type MemberOption = { id: string; name: string };

const defaultApi = createEventsApi();
const responseLabels: Record<AttendanceResponse, string> = {
  attending: '参加',
  absent: '欠席',
  pending: '未定',
};
const typeLabels = {
  practice: '練習',
  match: '試合',
  event: 'イベント',
} as const;

function monthRange(now = new Date()) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from: from.toISOString(), to: to.toISOString() };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
}

function getErrorMessage(error: unknown) {
  return error instanceof EventsApiError
    ? error.message
    : '予定の読み込みに失敗しました。';
}

function canManage(role: EventRole) {
  return role === 'owner' || role === 'admin' || role === 'staff';
}

function EventCard({
  event,
  api,
  role,
  memberOptions,
  onChanged,
}: {
  event: EventSummary;
  api: EventsApi;
  role: EventRole;
  memberOptions: MemberOption[];
  onChanged: () => void;
}) {
  const [memberId, setMemberId] = useState(memberOptions[0]?.id ?? '');
  const [response, setResponse] = useState<AttendanceResponse>('pending');
  const [correctionReason, setCorrectionReason] = useState('');
  const [summary, setSummary] = useState<Awaited<ReturnType<EventsApi['summary']>> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!memberOptions.some((member) => member.id === memberId))
      setMemberId(memberOptions[0]?.id ?? '');
  }, [memberId, memberOptions]);

  async function answer(eventSubmit: FormEvent<HTMLFormElement>) {
    eventSubmit.preventDefault();
    setIsSaving(true);
    setMessage(null);
    try {
      await api.answer(event.id, {
        memberId,
        response,
        ...(correctionReason.trim() ? { correctionReason: correctionReason.trim() } : {}),
      });
      setMessage('出欠を保存しました。');
      onChanged();
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function loadSummary() {
    setMessage(null);
    try {
      setSummary(await api.summary(event.id));
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }

  return (
    <article className={`event-card event-card-${event.type}`}>
      <p className="event-type">{typeLabels[event.type]}</p>
      <h3>{event.title}</h3>
      <p>
        {formatDate(event.startsAt)}〜{formatDate(event.endsAt)}
      </p>
      <p>出欠締切: {formatDate(event.attendanceDeadline)}</p>
      {event.location ? <p>場所: {event.location}</p> : null}
      {event.opponent ? <p>対戦相手: {event.opponent}</p> : null}
      {event.itemsToBring ? <p>持ち物: {event.itemsToBring}</p> : null}
      {event.fee > 0 ? <p>会費: {event.fee.toLocaleString('ja-JP')}円</p> : null}

      {memberOptions.length > 0 ? (
        <form onSubmit={answer}>
          <fieldset>
            <legend>出欠回答</legend>
            <label htmlFor={`event-${event.id}-member`}>部員</label>
            <select
              id={`event-${event.id}-member`}
              value={memberId}
              onChange={(input) => setMemberId(input.target.value)}
            >
              {memberOptions.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            <label htmlFor={`event-${event.id}-response`}>回答</label>
            <select
              id={`event-${event.id}-response`}
              value={response}
              onChange={(input) => setResponse(input.target.value as AttendanceResponse)}
            >
              {Object.entries(responseLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {canManage(role) ? (
              <label htmlFor={`event-${event.id}-reason`}>
                締切後の修正理由（該当時）
                <input
                  id={`event-${event.id}-reason`}
                  value={correctionReason}
                  onChange={(input) => setCorrectionReason(input.target.value)}
                />
              </label>
            ) : null}
            <button type="submit" disabled={isSaving || !memberId}>
              {isSaving ? '保存中…' : '出欠を保存'}
            </button>
          </fieldset>
        </form>
      ) : null}

      {canManage(role) ? (
        <div>
          <button type="button" onClick={() => void loadSummary()}>
            出欠を集計
          </button>
          {summary ? (
            <p role="status">
              全{summary.totalMembers}名、参加{summary.attending}名、欠席
              {summary.absent}名、未定{summary.pending}名、未回答
              {summary.unanswered}名
            </p>
          ) : null}
        </div>
      ) : null}
      {message ? <p role="alert">{message}</p> : null}
    </article>
  );
}

// 月間・週間の表示範囲を切り替え、予定表示と出欠操作を同じAPI契約へ接続する。
export function EventsPage({
  api = defaultApi,
  role,
  memberOptions = [],
}: {
  api?: EventsApi;
  role: EventRole;
  memberOptions?: MemberOption[];
}) {
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [attendanceDeadline, setAttendanceDeadline] = useState('');
  const [location, setLocation] = useState('');
  const [itemsToBring, setItemsToBring] = useState('');
  const [fee, setFee] = useState('0');
  const [opponent, setOpponent] = useState('');
  const [meetingTime, setMeetingTime] = useState('');
  const [transportationRequired, setTransportationRequired] = useState(false);
  const [type, setType] = useState<'practice' | 'match' | 'event'>('practice');

  const range = useMemo(() => monthRange(), []);
  const loadEvents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setEvents(await api.list(range.from, range.to));
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [api, range.from, range.to]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const displayedEvents = useMemo(() => {
    if (viewMode === 'month') return events;
    const weekEnd = Date.now() + 7 * 24 * 60 * 60 * 1000;
    return events.filter((event) => Date.parse(event.startsAt) <= weekEnd);
  }, [events, viewMode]);

  async function createEvent(eventSubmit: FormEvent<HTMLFormElement>) {
    eventSubmit.preventDefault();
    setSuccess(null);
    setError(null);
    try {
      await api.create({
        title: title.trim(),
        type,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        attendanceDeadline: new Date(attendanceDeadline).toISOString(),
        location: location.trim() || null,
        itemsToBring: itemsToBring.trim() || null,
        fee: Number(fee),
        ...(opponent.trim() ? { opponent: opponent.trim() } : {}),
        ...(meetingTime ? { meetingTime: new Date(meetingTime).toISOString() } : {}),
        transportationRequired,
      });
      setTitle('');
      setLocation('');
      setItemsToBring('');
      setFee('0');
      setOpponent('');
      setMeetingTime('');
      setTransportationRequired(false);
      setSuccess('予定を登録しました。');
      await loadEvents();
    } catch (createError) {
      setError(getErrorMessage(createError));
    }
  }

  return (
    <section aria-labelledby="events-heading">
      <header>
        <h1 id="events-heading">予定と出欠</h1>
        <p>予定の確認と、担当部員の出欠回答を行います。</p>
      </header>
      <div role="group" aria-label="表示範囲">
        <button type="button" aria-pressed={viewMode === 'month'} onClick={() => setViewMode('month')}>
          月間
        </button>
        <button type="button" aria-pressed={viewMode === 'week'} onClick={() => setViewMode('week')}>
          週間
        </button>
      </div>
      {canManage(role) ? (
        <form onSubmit={createEvent} aria-label="予定登録">
          <h2>予定を登録</h2>
          <label htmlFor="event-title">タイトル</label>
          <input id="event-title" value={title} onChange={(input) => setTitle(input.target.value)} required />
          <label htmlFor="event-type">種別</label>
          <select id="event-type" value={type} onChange={(input) => setType(input.target.value as typeof type)}>
            <option value="practice">練習</option>
            <option value="match">試合</option>
            <option value="event">イベント</option>
          </select>
          {type === 'match' ? (
            <>
              <label htmlFor="event-opponent">対戦相手</label>
              <input id="event-opponent" value={opponent} onChange={(input) => setOpponent(input.target.value)} required />
            </>
          ) : null}
          <label htmlFor="event-location">場所</label>
          <input id="event-location" value={location} onChange={(input) => setLocation(input.target.value)} />
          <label htmlFor="event-items">持ち物</label>
          <textarea id="event-items" value={itemsToBring} onChange={(input) => setItemsToBring(input.target.value)} />
          <label htmlFor="event-fee">会費（円）</label>
          <input id="event-fee" type="number" min="0" value={fee} onChange={(input) => setFee(input.target.value)} />
          <label htmlFor="event-meeting-time">集合時刻</label>
          <input id="event-meeting-time" type="datetime-local" value={meetingTime} onChange={(input) => setMeetingTime(input.target.value)} />
          <label htmlFor="event-transportation">
            <input id="event-transportation" type="checkbox" checked={transportationRequired} onChange={(input) => setTransportationRequired(input.target.checked)} />
            配車が必要
          </label>
          <label htmlFor="event-starts-at">開始</label>
          <input id="event-starts-at" type="datetime-local" value={startsAt} onChange={(input) => setStartsAt(input.target.value)} required />
          <label htmlFor="event-ends-at">終了</label>
          <input id="event-ends-at" type="datetime-local" value={endsAt} onChange={(input) => setEndsAt(input.target.value)} required />
          <label htmlFor="event-deadline">出欠締切</label>
          <input id="event-deadline" type="datetime-local" value={attendanceDeadline} onChange={(input) => setAttendanceDeadline(input.target.value)} required />
          <button type="submit">登録</button>
        </form>
      ) : null}
      {isLoading ? <p role="status">読み込み中…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {success ? <p role="status">{success}</p> : null}
      {!isLoading && !error && displayedEvents.length === 0 ? <p>予定はありません。</p> : null}
      <div aria-live="polite">
        {displayedEvents.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            api={api}
            role={role}
            memberOptions={memberOptions}
            onChanged={() => void loadEvents()}
          />
        ))}
      </div>
    </section>
  );
}
