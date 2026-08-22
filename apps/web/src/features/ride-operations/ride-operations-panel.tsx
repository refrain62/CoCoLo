import { validateGoogleMapsUrl } from '@cocolo/domain/ride';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  createRideOperationsApi,
  RideApiError,
  type RideDispatch,
  type RideMetrics,
  type RideOperationsApi,
  type RideSnapshot,
} from './ride-operations-api.js';

type RideMemberOption = { id: string; label: string };
type RideOperationsPanelProps = {
  planId: string;
  members: RideMemberOption[];
  isManager: boolean;
  api?: RideOperationsApi;
};

const defaultApi = createRideOperationsApi();

function errorMessage(error: unknown) {
  if (error instanceof RideApiError) return error.message;
  if (error instanceof Error) return error.message;
  return '通信に失敗しました。';
}

function SafeMapsLink({ url, label }: { url: string | null; label: string }) {
  let safeUrl: string | null = null;
  try {
    safeUrl = validateGoogleMapsUrl(url);
  } catch {
    safeUrl = null;
  }
  if (!safeUrl) return null;
  return (
    <a href={safeUrl} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

function statusLabel(status: RideSnapshot['requests'][number]['status']) {
  return {
    pending: '未確認',
    assigned: '割当済み',
    unassigned: '未割当',
    cancelled: '取消',
  }[status];
}

function historyLabel(action: RideSnapshot['history'][number]['action']) {
  return {
    plan_created: '送迎予定を作成',
    offer_registered: '車を登録',
    request_registered: '乗車希望を登録',
    matching_executed: '補助マッチングを実行',
    assignment_updated: '割当を変更',
    other: '送迎情報を変更',
  }[action];
}

function Metrics({ metrics }: { metrics: RideMetrics }) {
  return (
    <dl>
      <div>
        <dt>車の台数</dt>
        <dd>{metrics.offerCount}</dd>
      </div>
      <div>
        <dt>乗車可能数</dt>
        <dd>{metrics.totalCapacity}</dd>
      </div>
      <div>
        <dt>希望人数</dt>
        <dd>{metrics.requestedSeats}</dd>
      </div>
      <div>
        <dt>割当済み</dt>
        <dd>{metrics.assignedSeats}</dd>
      </div>
      <div>
        <dt>未割当</dt>
        <dd>{metrics.unassignedSeats}</dd>
      </div>
      <div>
        <dt>割当率</dt>
        <dd>{Math.round(metrics.assignmentRate * 100)}%</dd>
      </div>
    </dl>
  );
}

// 送迎の入力・利用者向け結果・管理者向け集計を同じ再読込経路へ揃え、古い割当表を表示し続けない。
export function RideOperationsPanel({
  planId,
  members,
  isManager,
  api = defaultApi,
}: RideOperationsPanelProps) {
  const [snapshot, setSnapshot] = useState<RideSnapshot | null>(null);
  const [metrics, setMetrics] = useState<RideMetrics | null>(null);
  const [dispatch, setDispatch] = useState<RideDispatch | null>(null);
  const [capacity, setCapacity] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState(
    members[0]?.id ?? '',
  );
  const [passengerCount, setPassengerCount] = useState('1');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const nextSnapshot = await api.getSnapshot(planId);
      setSnapshot(nextSnapshot);
      if (isManager) {
        const [nextMetrics, nextDispatch] = await Promise.all([
          api.getMetrics(planId),
          api.getDispatch(planId),
        ]);
        setMetrics(nextMetrics);
        setDispatch(nextDispatch);
      }
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, [api, isManager, planId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedCapacity = Number(capacity);
    if (
      !Number.isInteger(parsedCapacity) ||
      parsedCapacity < 1 ||
      parsedCapacity > 20
    ) {
      setError('乗車可能数は1〜20人の整数で入力してください。');
      return;
    }
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.createOffer(planId, { capacity: parsedCapacity });
      setCapacity('');
      setNotice('車の登録を受け付けました。');
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedCount = Number(passengerCount);
    if (!selectedMemberId) {
      setError('対象の部員を選択してください。');
      return;
    }
    if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 8) {
      setError('乗車希望人数は1〜8人の整数で入力してください。');
      return;
    }
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.createRequest(planId, {
        memberId: selectedMemberId,
        passengerCount: parsedCount,
      });
      setNotice('乗車希望を登録しました。');
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  async function autoMatch() {
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.autoMatch(planId);
      setNotice(
        `割当${result.assignments.length}件、未割当${result.unassignedRequestIds.length}件を反映しました。`,
      );
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading && !snapshot) return <p role="status">送迎情報を読み込み中…</p>;
  if (!snapshot)
    return <p role="alert">{error ?? '送迎情報を表示できません。'}</p>;

  return (
    <section aria-labelledby="ride-operations-heading">
      <h1 id="ride-operations-heading">送迎</h1>
      <p>
        {snapshot.plan.title}（出発{' '}
        {new Date(snapshot.plan.departureAt).toLocaleString('ja-JP')}）
      </p>
      <p>
        <SafeMapsLink
          url={snapshot.plan.pickupMapsUrl}
          label="集合場所を地図で開く"
        />{' '}
        <SafeMapsLink
          url={snapshot.plan.destinationMapsUrl}
          label="目的地を地図で開く"
        />
      </p>

      <section aria-labelledby="ride-offer-heading">
        <h2 id="ride-offer-heading">車を出す</h2>
        <form onSubmit={submitOffer}>
          <label htmlFor="ride-capacity">乗車可能数</label>
          <input
            id="ride-capacity"
            inputMode="numeric"
            min="1"
            max="20"
            type="number"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
          />
          <button type="submit" disabled={isSaving}>
            登録する
          </button>
        </form>
      </section>

      <section aria-labelledby="ride-request-heading">
        <h2 id="ride-request-heading">乗車を希望する</h2>
        {members.length === 0 ? (
          <p>担当できる部員がいないため、乗車希望を登録できません。</p>
        ) : (
          <form onSubmit={submitRequest}>
            <label htmlFor="ride-member">部員</label>
            <select
              id="ride-member"
              value={selectedMemberId}
              onChange={(event) => setSelectedMemberId(event.target.value)}
            >
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.label}
                </option>
              ))}
            </select>
            <label htmlFor="ride-passenger-count">人数</label>
            <input
              id="ride-passenger-count"
              inputMode="numeric"
              min="1"
              max="8"
              type="number"
              value={passengerCount}
              onChange={(event) => setPassengerCount(event.target.value)}
            />
            <button type="submit" disabled={isSaving}>
              登録する
            </button>
          </form>
        )}
      </section>

      <section aria-labelledby="ride-result-heading">
        <h2 id="ride-result-heading">割当結果</h2>
        {snapshot.requests.length === 0 ? (
          <p>乗車希望はありません。</p>
        ) : (
          <ul>
            {snapshot.requests.map((request) => (
              <li key={request.id}>
                {request.passengerCount}人、{statusLabel(request.status)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ride-history-heading">
        <h2 id="ride-history-heading">変更履歴</h2>
        {snapshot.history.length === 0 ? (
          <p>変更履歴はありません。</p>
        ) : (
          <ul>
            {snapshot.history.map((entry) => (
              <li key={entry.id}>
                {historyLabel(entry.action)}（
                {new Date(entry.createdAt).toLocaleString('ja-JP')}）
              </li>
            ))}
          </ul>
        )}
      </section>

      {isManager ? (
        <section aria-labelledby="ride-manager-heading">
          <h2 id="ride-manager-heading">運用管理</h2>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void autoMatch()}
          >
            補助マッチングを実行
          </button>
          {metrics ? <Metrics metrics={metrics} /> : null}
          {dispatch ? (
            <table>
              <caption>配車表</caption>
              <thead>
                <tr>
                  <th scope="col">運転者識別子</th>
                  <th scope="col">乗車希望識別子</th>
                  <th scope="col">人数</th>
                </tr>
              </thead>
              <tbody>
                {dispatch.assignments.map((assignment) => {
                  const offer = dispatch.offers.find(
                    (item) => item.id === assignment.offerId,
                  );
                  return (
                    <tr key={assignment.id}>
                      <td>{offer?.driverUserId ?? '不明'}</td>
                      <td>{assignment.requestId}</td>
                      <td>{assignment.passengerCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}

      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
