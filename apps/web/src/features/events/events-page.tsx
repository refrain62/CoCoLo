import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  readSubjectMemberId,
  writeSubjectMemberId,
} from '../../subject-member-selection.js';
import { EventDetailPage } from './event-detail-page.js';
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

function weekRange(now = new Date()) {
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
}

export function toDateTimeLocal(value: string) {
  const date = new Date(value);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function toTokyoIso(value: string) {
  const date = new Date(`${value}:00+09:00`);
  if (Number.isNaN(date.getTime())) throw new Error('日時の形式が不正です。');
  return date.toISOString();
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
  onOpenDetail,
  selectionStorageKey,
}: {
  event: EventSummary;
  api: EventsApi;
  role: EventRole;
  memberOptions: MemberOption[];
  onChanged: () => void;
  onOpenDetail: () => void;
  selectionStorageKey: string;
}) {
  const [memberId, setMemberId] = useState(() =>
    readSubjectMemberId(selectionStorageKey, memberOptions),
  );
  const [response, setResponse] = useState<AttendanceResponse>('pending');
  const [correctionReason, setCorrectionReason] = useState('');
  const [summary, setSummary] = useState<Awaited<
    ReturnType<EventsApi['summary']>
  > | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(event.title);
  const [editStartsAt, setEditStartsAt] = useState(
    toDateTimeLocal(event.startsAt),
  );
  const [editEndsAt, setEditEndsAt] = useState(toDateTimeLocal(event.endsAt));
  const [editDeadline, setEditDeadline] = useState(
    toDateTimeLocal(event.attendanceDeadline),
  );
  const [editLocation, setEditLocation] = useState(event.location ?? '');
  const [editItemsToBring, setEditItemsToBring] = useState(
    event.itemsToBring ?? '',
  );
  const [editFee, setEditFee] = useState(String(event.fee));
  const [
    editAnnouncementImageAttachmentId,
    setEditAnnouncementImageAttachmentId,
  ] = useState(event.announcementImageAttachmentId ?? '');
  const [editOpponent, setEditOpponent] = useState(event.opponent ?? '');
  const [editMeetingTime, setEditMeetingTime] = useState(
    event.meetingTime ? toDateTimeLocal(event.meetingTime) : '',
  );
  const [editTransportationRequired, setEditTransportationRequired] = useState(
    event.transportationRequired,
  );

  useEffect(() => {
    if (!memberOptions.some((member) => member.id === memberId))
      setMemberId(readSubjectMemberId(selectionStorageKey, memberOptions));
  }, [memberId, memberOptions, selectionStorageKey]);

  async function answer(eventSubmit: FormEvent<HTMLFormElement>) {
    eventSubmit.preventDefault();
    setIsSaving(true);
    setMessage(null);
    try {
      await api.answer(event.id, {
        subjectMemberId: memberId,
        response,
        ...(correctionReason.trim()
          ? { correctionReason: correctionReason.trim() }
          : {}),
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

  async function updateEvent(eventSubmit: FormEvent<HTMLFormElement>) {
    eventSubmit.preventDefault();
    setIsSaving(true);
    setMessage(null);
    try {
      await api.update(event.id, {
        title: editTitle.trim(),
        startsAt: toTokyoIso(editStartsAt),
        endsAt: toTokyoIso(editEndsAt),
        attendanceDeadline: toTokyoIso(editDeadline),
        location: editLocation.trim() || null,
        itemsToBring: editItemsToBring.trim() || null,
        fee: Number(editFee),
        announcementImageAttachmentId:
          editAnnouncementImageAttachmentId.trim() || null,
        opponent: editOpponent.trim() || null,
        meetingTime: editMeetingTime ? toTokyoIso(editMeetingTime) : null,
        transportationRequired: editTransportationRequired,
      });
      setIsEditing(false);
      setMessage('予定を更新しました。');
      onChanged();
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className={`event-card event-card-${event.type}`}>
      <p className="event-type">{typeLabels[event.type]}</p>
      <h3>{event.title}</h3>
      <button type="button" onClick={onOpenDetail}>
        予定詳細を開く
      </button>
      <p>
        {formatDate(event.startsAt)}〜{formatDate(event.endsAt)}
      </p>
      <p>出欠締切: {formatDate(event.attendanceDeadline)}</p>
      {event.location ? <p>場所: {event.location}</p> : null}
      {event.opponent ? <p>対戦相手: {event.opponent}</p> : null}
      {event.itemsToBring ? <p>持ち物: {event.itemsToBring}</p> : null}
      {event.fee > 0 ? (
        <p>会費: {event.fee.toLocaleString('ja-JP')}円</p>
      ) : null}

      {canManage(role) ? (
        <div>
          <button
            type="button"
            onClick={() => setIsEditing((current) => !current)}
          >
            {isEditing ? '編集を閉じる' : '予定を編集'}
          </button>
          {isEditing ? (
            <form onSubmit={updateEvent}>
              <label htmlFor={`event-${event.id}-edit-title`}>タイトル</label>
              <input
                id={`event-${event.id}-edit-title`}
                value={editTitle}
                onChange={(input) => setEditTitle(input.target.value)}
                required
              />
              <label htmlFor={`event-${event.id}-edit-starts`}>開始</label>
              <input
                id={`event-${event.id}-edit-starts`}
                type="datetime-local"
                value={editStartsAt}
                onChange={(input) => setEditStartsAt(input.target.value)}
                required
              />
              <label htmlFor={`event-${event.id}-edit-ends`}>終了</label>
              <input
                id={`event-${event.id}-edit-ends`}
                type="datetime-local"
                value={editEndsAt}
                onChange={(input) => setEditEndsAt(input.target.value)}
                required
              />
              <label htmlFor={`event-${event.id}-edit-location`}>場所</label>
              <input
                id={`event-${event.id}-edit-location`}
                value={editLocation}
                onChange={(input) => setEditLocation(input.target.value)}
              />
              <label htmlFor={`event-${event.id}-edit-items`}>持ち物</label>
              <textarea
                id={`event-${event.id}-edit-items`}
                value={editItemsToBring}
                onChange={(input) => setEditItemsToBring(input.target.value)}
              />
              <label htmlFor={`event-${event.id}-edit-fee`}>会費（円）</label>
              <input
                id={`event-${event.id}-edit-fee`}
                type="number"
                min="0"
                value={editFee}
                onChange={(input) => setEditFee(input.target.value)}
              />
              <label htmlFor={`event-${event.id}-edit-attachment`}>
                案内画像の添付ID
              </label>
              <input
                id={`event-${event.id}-edit-attachment`}
                value={editAnnouncementImageAttachmentId}
                onChange={(input) =>
                  setEditAnnouncementImageAttachmentId(input.target.value)
                }
              />
              <label htmlFor={`event-${event.id}-edit-opponent`}>
                対戦相手
              </label>
              <input
                id={`event-${event.id}-edit-opponent`}
                value={editOpponent}
                onChange={(input) => setEditOpponent(input.target.value)}
              />
              <label htmlFor={`event-${event.id}-edit-meeting-time`}>
                集合時刻
              </label>
              <input
                id={`event-${event.id}-edit-meeting-time`}
                type="datetime-local"
                value={editMeetingTime}
                onChange={(input) => setEditMeetingTime(input.target.value)}
              />
              <label htmlFor={`event-${event.id}-edit-transportation`}>
                <input
                  id={`event-${event.id}-edit-transportation`}
                  type="checkbox"
                  checked={editTransportationRequired}
                  onChange={(input) =>
                    setEditTransportationRequired(input.target.checked)
                  }
                />
                配車が必要
              </label>
              <label htmlFor={`event-${event.id}-edit-deadline`}>
                出欠締切
              </label>
              <input
                id={`event-${event.id}-edit-deadline`}
                type="datetime-local"
                value={editDeadline}
                onChange={(input) => setEditDeadline(input.target.value)}
                required
              />
              <button type="submit" disabled={isSaving}>
                更新
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {memberOptions.length > 0 ? (
        <form onSubmit={answer}>
          <fieldset>
            <legend>出欠回答</legend>
            <label htmlFor={`event-${event.id}-member`}>部員</label>
            <select
              id={`event-${event.id}-member`}
              value={memberId}
              onChange={(input) => {
                setMemberId(input.target.value);
                writeSubjectMemberId(selectionStorageKey, input.target.value);
              }}
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
              onChange={(input) =>
                setResponse(input.target.value as AttendanceResponse)
              }
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
  selectionStorageKey = 'cocolo.selectedSubjectMemberId',
  initialEventId,
  onBack,
  onAccessDenied,
}: {
  api?: EventsApi;
  role: EventRole;
  memberOptions?: MemberOption[];
  selectionStorageKey?: string;
  initialEventId?: string;
  onBack?: () => void;
  onAccessDenied?: () => void;
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
  const [announcementImageAttachmentId, setAnnouncementImageAttachmentId] =
    useState('');
  const [opponent, setOpponent] = useState('');
  const [meetingTime, setMeetingTime] = useState('');
  const [transportationRequired, setTransportationRequired] = useState(false);
  const [type, setType] = useState<'practice' | 'match' | 'event'>('practice');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    initialEventId ?? null,
  );
  const [isCreating, setIsCreating] = useState(false);

  const range = useMemo(
    () => (viewMode === 'month' ? monthRange() : weekRange()),
    [viewMode],
  );
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

  useEffect(() => {
    setSelectedEventId(initialEventId ?? null);
  }, [initialEventId]);

  const displayedEvents = useMemo(() => {
    if (viewMode === 'month') return events;
    return events.filter(
      (event) =>
        Date.parse(event.startsAt) >= Date.parse(range.from) &&
        Date.parse(event.startsAt) < Date.parse(range.to),
    );
  }, [events, range.from, range.to, viewMode]);

  const selectedEvent = events.find((event) => event.id === selectedEventId);
  if (selectedEventId) {
    return (
      <EventDetailPage
        api={api}
        eventId={selectedEventId}
        role={role}
        memberOptions={memberOptions}
        fallbackEvent={selectedEvent}
        onBack={() => {
          if (onBack) onBack();
          else setSelectedEventId(null);
        }}
        selectionStorageKey={selectionStorageKey}
        onAccessDenied={onAccessDenied}
      />
    );
  }

  async function createEvent(eventSubmit: FormEvent<HTMLFormElement>) {
    eventSubmit.preventDefault();
    if (isCreating) return;
    setSuccess(null);
    setError(null);
    setIsCreating(true);
    try {
      await api.create({
        title: title.trim(),
        type,
        startsAt: toTokyoIso(startsAt),
        endsAt: toTokyoIso(endsAt),
        attendanceDeadline: toTokyoIso(attendanceDeadline),
        location: location.trim() || null,
        itemsToBring: itemsToBring.trim() || null,
        fee: Number(fee),
        announcementImageAttachmentId:
          announcementImageAttachmentId.trim() || null,
        ...(opponent.trim() ? { opponent: opponent.trim() } : {}),
        ...(meetingTime ? { meetingTime: toTokyoIso(meetingTime) } : {}),
        transportationRequired,
      });
      setTitle('');
      setLocation('');
      setItemsToBring('');
      setFee('0');
      setAnnouncementImageAttachmentId('');
      setOpponent('');
      setMeetingTime('');
      setTransportationRequired(false);
      setSuccess('予定を登録しました。');
      await loadEvents();
    } catch (createError) {
      setError(getErrorMessage(createError));
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <section aria-labelledby="events-heading">
      <header>
        <h1 id="events-heading">予定と出欠</h1>
        <p>予定の確認と、担当部員の出欠回答を行います。</p>
      </header>
      <fieldset aria-label="表示範囲">
        <button
          type="button"
          aria-pressed={viewMode === 'month'}
          onClick={() => setViewMode('month')}
        >
          月間
        </button>
        <button
          type="button"
          aria-pressed={viewMode === 'week'}
          onClick={() => setViewMode('week')}
        >
          週間
        </button>
      </fieldset>
      {canManage(role) ? (
        <form onSubmit={createEvent} aria-label="予定登録">
          <h2>予定を登録</h2>
          <label htmlFor="event-title">タイトル</label>
          <input
            id="event-title"
            value={title}
            onChange={(input) => setTitle(input.target.value)}
            required
          />
          <label htmlFor="event-type">種別</label>
          <select
            id="event-type"
            value={type}
            onChange={(input) => setType(input.target.value as typeof type)}
          >
            <option value="practice">練習</option>
            <option value="match">試合</option>
            <option value="event">イベント</option>
          </select>
          {type === 'match' ? (
            <>
              <label htmlFor="event-opponent">対戦相手</label>
              <input
                id="event-opponent"
                value={opponent}
                onChange={(input) => setOpponent(input.target.value)}
                required
              />
            </>
          ) : null}
          <label htmlFor="event-location">場所</label>
          <input
            id="event-location"
            value={location}
            onChange={(input) => setLocation(input.target.value)}
          />
          <label htmlFor="event-items">持ち物</label>
          <textarea
            id="event-items"
            value={itemsToBring}
            onChange={(input) => setItemsToBring(input.target.value)}
          />
          <label htmlFor="event-fee">会費（円）</label>
          <input
            id="event-fee"
            type="number"
            min="0"
            value={fee}
            onChange={(input) => setFee(input.target.value)}
          />
          <label htmlFor="event-announcement-attachment">
            案内画像の添付ID
          </label>
          <input
            id="event-announcement-attachment"
            value={announcementImageAttachmentId}
            onChange={(input) =>
              setAnnouncementImageAttachmentId(input.target.value)
            }
          />
          <label htmlFor="event-meeting-time">集合時刻</label>
          <input
            id="event-meeting-time"
            type="datetime-local"
            value={meetingTime}
            onChange={(input) => setMeetingTime(input.target.value)}
          />
          <label htmlFor="event-transportation">
            <input
              id="event-transportation"
              type="checkbox"
              checked={transportationRequired}
              onChange={(input) =>
                setTransportationRequired(input.target.checked)
              }
            />
            配車が必要
          </label>
          <label htmlFor="event-starts-at">開始</label>
          <input
            id="event-starts-at"
            type="datetime-local"
            value={startsAt}
            onChange={(input) => setStartsAt(input.target.value)}
            required
          />
          <label htmlFor="event-ends-at">終了</label>
          <input
            id="event-ends-at"
            type="datetime-local"
            value={endsAt}
            onChange={(input) => setEndsAt(input.target.value)}
            required
          />
          <label htmlFor="event-deadline">出欠締切</label>
          <input
            id="event-deadline"
            type="datetime-local"
            value={attendanceDeadline}
            onChange={(input) => setAttendanceDeadline(input.target.value)}
            required
          />
          <button type="submit" disabled={isCreating}>
            {isCreating ? '登録中…' : '登録'}
          </button>
        </form>
      ) : null}
      {isLoading ? <p role="status">読み込み中…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {success ? <p role="status">{success}</p> : null}
      {!isLoading && !error && displayedEvents.length === 0 ? (
        <p role="status">予定はありません。</p>
      ) : null}
      <div aria-live="polite">
        {displayedEvents.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            api={api}
            role={role}
            memberOptions={memberOptions}
            selectionStorageKey={selectionStorageKey}
            onChanged={() => void loadEvents()}
            onOpenDetail={() => setSelectedEventId(event.id)}
          />
        ))}
      </div>
    </section>
  );
}
