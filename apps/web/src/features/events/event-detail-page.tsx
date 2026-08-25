import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  readSubjectMemberId,
  writeSubjectMemberId,
} from '../../subject-member-selection.js';
import {
  type AttendanceResponse,
  type EventRole,
  type EventSummary,
  type EventsApi,
  EventsApiError,
} from './events-api.js';

type MemberOption = { id: string; name: string };

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

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
}

function canManage(role: EventRole) {
  return role === 'owner' || role === 'admin' || role === 'staff';
}

function errorMessage(error: unknown) {
  return error instanceof EventsApiError
    ? error.message
    : '予定詳細の読み込みに失敗しました。';
}

function isResourceUnavailable(error: unknown) {
  return (
    error instanceof EventsApiError &&
    (error.status === 403 || error.status === 404)
  );
}

// 予定の詳細と、現在保存されている出欠状態を同じ認可済みAPIから表示する。
export function EventDetailPage({
  api,
  eventId,
  role,
  memberOptions,
  fallbackEvent,
  onBack,
  selectionStorageKey,
  onAccessDenied,
}: {
  api: EventsApi;
  eventId: string;
  role: EventRole;
  memberOptions: MemberOption[];
  fallbackEvent?: EventSummary;
  onBack: () => void;
  selectionStorageKey: string;
  onAccessDenied?: () => void;
}) {
  const [event, setEvent] = useState<EventSummary | null>(
    fallbackEvent ?? null,
  );
  const [attendance, setAttendance] = useState<
    Awaited<ReturnType<EventsApi['currentAttendance']>>
  >([]);
  const [memberId, setMemberId] = useState(() =>
    readSubjectMemberId(selectionStorageKey, memberOptions),
  );
  const [response, setResponse] = useState<AttendanceResponse>('pending');
  const [correctionReason, setCorrectionReason] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [resourceUnavailable, setResourceUnavailable] = useState(false);

  const selectedAttendance = useMemo(
    () => attendance.find((item) => item.memberId === memberId),
    [attendance, memberId],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      const [loadedEvent, loadedAttendance] = await Promise.all([
        api.get(eventId),
        api.currentAttendance(eventId),
      ]);
      setEvent(loadedEvent);
      setAttendance(loadedAttendance);
      setResourceUnavailable(false);
    } catch (error) {
      setMessage(errorMessage(error));
      setResourceUnavailable(isResourceUnavailable(error));
    } finally {
      setIsLoading(false);
    }
  }, [api, eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!memberOptions.some((member) => member.id === memberId))
      setMemberId(readSubjectMemberId(selectionStorageKey, memberOptions));
  }, [memberId, memberOptions, selectionStorageKey]);

  useEffect(() => {
    setResponse(selectedAttendance?.response ?? 'pending');
  }, [selectedAttendance]);

  async function submit() {
    if (!memberId) return;
    setIsSaving(true);
    setMessage(null);
    try {
      await api.answer(eventId, {
        subjectMemberId: memberId,
        response,
        ...(correctionReason.trim()
          ? { correctionReason: correctionReason.trim() }
          : {}),
      });
      setMessage('出欠を保存しました。');
      setAttendance(await api.currentAttendance(eventId));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading && !event) return <p role="status">予定詳細を読み込み中…</p>;
  if (!event && resourceUnavailable)
    return (
      <section role="alert">
        <p>
          この予定は表示できません。削除済み、期限切れ、または現在のチームで権限がない可能性があります。
        </p>
        {onAccessDenied ? (
          <button type="button" onClick={onAccessDenied}>
            チームを選び直す
          </button>
        ) : null}
      </section>
    );
  if (!event) return <p role="alert">{message ?? '予定が見つかりません。'}</p>;

  return (
    <section aria-labelledby="event-detail-heading">
      <button type="button" onClick={onBack}>
        予定一覧へ戻る
      </button>
      <header>
        <p>{typeLabels[event.type]}</p>
        <h1 id="event-detail-heading">{event.title}</h1>
        <p>
          {formatDate(event.startsAt)}〜{formatDate(event.endsAt)}
        </p>
      </header>
      <dl>
        <dt>出欠締切</dt>
        <dd>{formatDate(event.attendanceDeadline)}</dd>
        {event.location ? (
          <>
            <dt>場所</dt>
            <dd>{event.location}</dd>
          </>
        ) : null}
        {event.opponent ? (
          <>
            <dt>対戦相手</dt>
            <dd>{event.opponent}</dd>
          </>
        ) : null}
        {event.itemsToBring ? (
          <>
            <dt>持ち物</dt>
            <dd>{event.itemsToBring}</dd>
          </>
        ) : null}
        {event.meetingTime ? (
          <>
            <dt>集合時刻</dt>
            <dd>{formatDate(event.meetingTime)}</dd>
          </>
        ) : null}
        <dt>配車</dt>
        <dd>{event.transportationRequired ? '必要' : '不要'}</dd>
        <dt>会費</dt>
        <dd>{event.fee.toLocaleString('ja-JP')}円</dd>
      </dl>

      <section aria-labelledby="attendance-status-heading">
        <h2 id="attendance-status-heading">現在の出欠</h2>
        {attendance.length === 0 ? <p>回答はまだありません。</p> : null}
        <ul>
          {attendance.map((item) => (
            <li key={`${item.memberId}-${item.eventId}`}>
              {memberOptions.find((member) => member.id === item.memberId)
                ?.name ?? '部員'}
              ：{responseLabels[item.response]}
            </li>
          ))}
        </ul>
      </section>

      {memberOptions.length > 0 ? (
        <form
          onSubmit={(formEvent) => {
            formEvent.preventDefault();
            void submit();
          }}
        >
          <fieldset>
            <legend>出欠を回答</legend>
            <label htmlFor="event-detail-member">部員</label>
            <select
              id="event-detail-member"
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
            <label htmlFor="event-detail-response">回答</label>
            <select
              id="event-detail-response"
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
              <label htmlFor="event-detail-correction-reason">
                締切後の修正理由（該当時）
                <input
                  id="event-detail-correction-reason"
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
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
