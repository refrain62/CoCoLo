import { useEffect, useState } from 'react';
import {
  type EventSummary,
  type EventsApi,
  EventsApiError,
} from './events-api.js';
import './events.css';

const typeLabels: Record<EventSummary['type'], string> = {
  practice: '練習',
  match: '試合',
  event: 'イベント',
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
}

function errorMessage(error: unknown) {
  return error instanceof EventsApiError
    ? error.message
    : '予定詳細の読み込みに失敗しました。';
}

// URLから表示対象を固定し、一覧画面を経由しない通知リンクでも同じ認証APIで詳細を取得する。
export function EventDetailPage({
  api,
  eventId,
}: {
  api: EventsApi;
  eventId: string;
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
        if (active) setMessage(errorMessage(error));
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
    <section aria-labelledby="event-detail-heading">
      <p>
        <a href="/events">予定一覧へ戻る</a>
      </p>
      <header>
        <p className="event-type">{typeLabels[event.type]}</p>
        <h1 id="event-detail-heading">{event.title}</h1>
      </header>
      <dl>
        <dt>開始</dt>
        <dd>{formatDate(event.startsAt)}</dd>
        <dt>終了</dt>
        <dd>{formatDate(event.endsAt)}</dd>
        <dt>出欠締切</dt>
        <dd>{formatDate(event.attendanceDeadline)}</dd>
        <dt>場所</dt>
        <dd>{event.location ?? '未設定'}</dd>
        <dt>持ち物</dt>
        <dd>{event.itemsToBring ?? '未設定'}</dd>
        <dt>会費</dt>
        <dd>{event.fee.toLocaleString('ja-JP')}円</dd>
        <dt>対戦相手</dt>
        <dd>{event.opponent ?? '該当なし'}</dd>
        <dt>集合時刻</dt>
        <dd>{event.meetingTime ? formatDate(event.meetingTime) : '未設定'}</dd>
        <dt>配車</dt>
        <dd>{event.transportationRequired ? '必要' : '不要'}</dd>
      </dl>
      <p>出欠の回答と集計は予定一覧から行えます。</p>
    </section>
  );
}
