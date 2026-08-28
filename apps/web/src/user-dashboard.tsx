import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Section,
} from '@cocolo/ui';
import { useEffect, useMemo, useState } from 'react';
import type { EventSummary, EventsApi } from './features/events/events-api.js';
import type {
  FeatureContractApi,
  FeatureContractSnapshot,
} from './features/feature-contract/feature-contract-api.js';
import type {
  OrdersCampaign,
  OrdersPaymentsApi,
} from './features/orders-payments/orders-payments-api.js';
import type { GlobalAnnouncementsApi } from './global-announcements-api.js';
import {
  buildDashboardItems,
  type DashboardItem,
  formatDashboardDateTime,
  getDashboardDateKeys,
  getDashboardRange,
  itemsByDate,
  tokyoDateKey,
} from './user-dashboard-utils.js';
import './user-dashboard.css';

const eventTypeLabels: Record<EventSummary['type'], string> = {
  practice: '練習',
  match: '試合',
  event: 'イベント',
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function DashboardItemLabel({ item }: { item: DashboardItem }) {
  if (item.kind === 'event')
    return (
      <>
        <Badge variant="success">{eventTypeLabels[item.eventType]}</Badge>
        <strong>{item.title}</strong>
      </>
    );
  return (
    <>
      <Badge variant={item.status === 'open' ? 'default' : 'secondary'}>
        {item.deadlineType === 'attendance' ? '出欠締切' : '注文締切'}
      </Badge>
      <strong>{item.title}</strong>
    </>
  );
}

export function UserDashboard({
  eventsApi,
  featureContract,
  featureContractApi,
  globalAnnouncementsApi,
  onNavigate,
  ordersApi,
}: {
  eventsApi: EventsApi;
  featureContract?: FeatureContractSnapshot;
  featureContractApi: FeatureContractApi;
  globalAnnouncementsApi: GlobalAnnouncementsApi;
  onNavigate: (path: string) => void;
  ordersApi: OrdersPaymentsApi;
}) {
  const range = useMemo(() => getDashboardRange(), []);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [campaigns, setCampaigns] = useState<OrdersCampaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [globalAnnouncements, setGlobalAnnouncements] = useState<
    Awaited<ReturnType<GlobalAnnouncementsApi['list']>>
  >([]);
  const [globalAnnouncementsError, setGlobalAnnouncementsError] = useState<
    string | null
  >(null);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);
    setGlobalAnnouncements([]);
    setGlobalAnnouncementsError(null);
    void globalAnnouncementsApi
      .list()
      .then((nextAnnouncements) => {
        if (active) setGlobalAnnouncements(nextAnnouncements);
      })
      .catch((requestError: unknown) => {
        if (active)
          setGlobalAnnouncementsError(
            errorMessage(
              requestError,
              'システムからのお知らせを取得できません。',
            ),
          );
      });
    void (
      featureContract
        ? Promise.resolve(featureContract)
        : featureContractApi.get()
    )
      .then(async (contract) => {
        const eventsEnabled = contract.features.some(
          (feature) => feature.key === 'events-attendance' && feature.enabled,
        );
        const eventsPromise = eventsEnabled
          ? eventsApi.list(range.from.toISOString(), range.to.toISOString())
          : Promise.resolve([] as EventSummary[]);
        const ordersPromise = contract.features.some(
          (feature) => feature.key === 'orders-payments' && feature.enabled,
        )
          ? ordersApi.listCampaigns()
          : Promise.resolve([] as OrdersCampaign[]);
        const [nextEvents, nextCampaigns] = await Promise.allSettled([
          eventsPromise,
          ordersPromise,
        ]);
        if (!active) return;
        if (nextEvents.status === 'rejected') throw nextEvents.reason;
        setEvents(nextEvents.value);
        if (nextCampaigns.status === 'fulfilled') {
          setCampaigns(nextCampaigns.value);
          setOrdersError(null);
        } else {
          setCampaigns([]);
          setOrdersError(
            errorMessage(nextCampaigns.reason, '注文締切を取得できません。'),
          );
        }
      })
      .catch((requestError: unknown) => {
        if (active)
          setError(
            errorMessage(
              requestError,
              'ダッシュボードの読み込みに失敗しました。',
            ),
          );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    eventsApi,
    featureContract,
    featureContractApi,
    globalAnnouncementsApi,
    ordersApi,
    range,
  ]);

  const items = useMemo(
    () => buildDashboardItems(events, campaigns, range),
    [campaigns, events, range],
  );
  const groupedItems = useMemo(() => itemsByDate(items), [items]);
  const dateKeys = useMemo(() => getDashboardDateKeys(range), [range]);
  const todayKey = tokyoDateKey(new Date());

  return (
    <div className="user-dashboard-page">
      {globalAnnouncementsError ? (
        <p className="dashboard-inline-warning" role="status">
          {globalAnnouncementsError}
        </p>
      ) : null}
      {globalAnnouncements.length > 0 ? (
        <Section
          eyebrow="System notice"
          title="システムからのお知らせ"
          description="CoCoLo運営から、すべてのチームへ向けたお知らせです。"
        >
          <div className="dashboard-global-announcements">
            {globalAnnouncements.map((announcement) => (
              <article
                className="dashboard-global-announcement"
                key={announcement.id}
              >
                <header>
                  <h3>{announcement.title}</h3>
                  <time dateTime={announcement.publishedAt ?? undefined}>
                    {announcement.publishedAt
                      ? formatDashboardDateTime(announcement.publishedAt)
                      : ''}
                  </time>
                </header>
                <p>{announcement.body}</p>
              </article>
            ))}
          </div>
        </Section>
      ) : null}
      <Section
        eyebrow="Dashboard"
        title="これからの予定"
        description="今日から14日間の予定と、回答・注文の締め切りをまとめています。"
        actions={
          <button
            className="dashboard-text-link"
            type="button"
            onClick={() => onNavigate('/team/events')}
          >
            予定をすべて見る →
          </button>
        }
      >
        {isLoading ? (
          <section className="dashboard-state" role="status">
            予定を読み込んでいます。
          </section>
        ) : error ? (
          <section
            className="dashboard-state dashboard-state-error"
            role="alert"
          >
            {error}
          </section>
        ) : (
          <>
            <div className="dashboard-calendar">
              {dateKeys.map((dateKey) => {
                const date = new Date(`${dateKey}T00:00:00+09:00`);
                const dayItems = groupedItems.get(dateKey) ?? [];
                return (
                  <article
                    className={`dashboard-calendar-day${dateKey === todayKey ? ' is-today' : ''}`}
                    key={dateKey}
                  >
                    <header>
                      <span>
                        {new Intl.DateTimeFormat('ja-JP', {
                          weekday: 'short',
                          timeZone: 'Asia/Tokyo',
                        }).format(date)}
                      </span>
                      <strong>{Number(dateKey.slice(-2))}</strong>
                    </header>
                    <div className="dashboard-calendar-items">
                      {dayItems.length > 0 ? (
                        dayItems.map((item) => (
                          <button
                            className={`dashboard-calendar-item dashboard-calendar-item-${item.kind}`}
                            key={item.id}
                            type="button"
                            onClick={() =>
                              onNavigate(
                                item.kind === 'event'
                                  ? '/team/events'
                                  : item.href,
                              )
                            }
                          >
                            <span>
                              {new Intl.DateTimeFormat('ja-JP', {
                                hour: '2-digit',
                                minute: '2-digit',
                                timeZone: 'Asia/Tokyo',
                              }).format(
                                new Date(
                                  item.kind === 'event'
                                    ? item.startsAt
                                    : item.deadlineAt,
                                ),
                              )}
                            </span>
                            <strong>{item.title}</strong>
                          </button>
                        ))
                      ) : (
                        <span className="dashboard-calendar-empty">—</span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            {ordersError ? (
              <p className="dashboard-inline-warning" role="status">
                {ordersError}
              </p>
            ) : null}
          </>
        )}
      </Section>

      {!isLoading && !error ? (
        <Section
          eyebrow="Next actions"
          title="一覧で確認"
          description="時刻順に、予定と締め切りを表示しています。"
        >
          {items.length > 0 ? (
            <div className="dashboard-item-list">
              {items.map((item) => (
                <Card className="dashboard-item-card" key={item.id}>
                  <CardHeader>
                    <CardDescription>
                      {item.kind === 'event'
                        ? formatDashboardDateTime(item.startsAt)
                        : formatDashboardDateTime(item.deadlineAt)}
                    </CardDescription>
                    <CardTitle>
                      <DashboardItemLabel item={item} />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {item.kind === 'event' ? (
                      <p>
                        {item.location ? `場所: ${item.location}` : '場所未定'}
                      </p>
                    ) : (
                      <button
                        className="dashboard-text-link"
                        type="button"
                        onClick={() => onNavigate(item.href)}
                      >
                        詳細を確認 →
                      </button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <section className="dashboard-state">
              直近14日間の予定と締め切りはありません。
            </section>
          )}
        </Section>
      ) : null}
    </div>
  );
}
