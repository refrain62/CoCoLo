import { validateGoogleMapsUrl } from '@cocolo/domain/ride';
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@cocolo/ui';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  readSubjectMemberId,
  writeSubjectMemberId,
} from '../../subject-member-selection.js';
import {
  createRideOperationsApi,
  RideApiError,
  type RideConfirmedAssignment,
  type RideDispatch,
  type RideMetrics,
  type RideOperationsApi,
  type RidePlan,
  type RidePlanTransitionInput,
  type RidePlanUpdateInput,
  type RideSnapshot,
} from './ride-operations-api.js';

type RideMemberOption = { id: string; label: string };
type ConfirmableRideAction =
  | { kind: 'transition'; action: RidePlanTransitionInput['action'] }
  | { kind: 'match' };
type RideOperationsPanelProps = {
  planId?: string;
  plans?: RidePlan[];
  members: RideMemberOption[];
  isManager: boolean;
  api?: RideOperationsApi;
  selectionStorageKey?: string;
};

const defaultApi = createRideOperationsApi();

function errorMessage(error: unknown) {
  if (error instanceof RideApiError) return error.message;
  if (error instanceof Error) return error.message;
  return '通信に失敗しました。';
}

export function SafeMapsLink({
  url,
  label,
  missingMessage,
}: {
  url: string | null;
  label: string;
  missingMessage?: string;
}) {
  let safeUrl: string | null = null;
  try {
    safeUrl = validateGoogleMapsUrl(url);
  } catch {
    safeUrl = null;
  }
  if (!url) return <span>{missingMessage ?? `${label}: 未設定`}</span>;
  if (!safeUrl) return <span>{label}: URLを確認できません</span>;
  return (
    <a href={safeUrl} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

export function GuardianConfirmedAssignments({
  status,
  assignments,
}: {
  status: RidePlan['status'];
  assignments: RideConfirmedAssignment[];
}) {
  if (status !== 'finalized' || assignments.length === 0) return null;

  return (
    <section aria-labelledby="ride-assignment-heading">
      <h3 id="ride-assignment-heading">確定した配車</h3>
      <ul>
        {assignments.map((assignment) => (
          <li key={assignment.id}>
            {assignment.memberName}：運転者 {assignment.driverName}、
            {assignment.passengerCount}人
          </li>
        ))}
      </ul>
    </section>
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
    plan_closed: '受付を終了',
    plan_finalized: '配車表を公開',
    plan_reopened: '公開後の再編集を開始',
    other: '送迎情報を変更',
  }[action];
}

function planStatusLabel(status: RidePlan['status']) {
  return {
    draft: '下書き',
    open: '受付中',
    closed: '締切済み',
    finalized: '公開済み',
  }[status];
}

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
  plans,
  members,
  isManager,
  api = defaultApi,
  selectionStorageKey = 'cocolo.selectedSubjectMemberId',
}: RideOperationsPanelProps) {
  const [loadedPlans, setLoadedPlans] = useState<RidePlan[]>([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState(plans === undefined);
  const [selectedPlanId, setSelectedPlanId] = useState(
    () => planId ?? plans?.[0]?.id ?? '',
  );
  const [snapshot, setSnapshot] = useState<RideSnapshot | null>(null);
  const [metrics, setMetrics] = useState<RideMetrics | null>(null);
  const [dispatch, setDispatch] = useState<RideDispatch | null>(null);
  const [capacity, setCapacity] = useState('');
  const [driverDisplayName, setDriverDisplayName] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState(() =>
    readSubjectMemberId(selectionStorageKey, members),
  );
  const [passengerCount, setPassengerCount] = useState('1');
  const [transitionReasonCode, setTransitionReasonCode] = useState('');
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const [selectedOfferId, setSelectedOfferId] = useState('');
  const [planTitle, setPlanTitle] = useState('');
  const [planDepartureAt, setPlanDepartureAt] = useState('');
  const [planPickupMapsUrl, setPlanPickupMapsUrl] = useState('');
  const [planDestinationMapsUrl, setPlanDestinationMapsUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] =
    useState<ConfirmableRideAction | null>(null);
  const loadGeneration = useRef(0);

  const planOptions = plans ?? loadedPlans;
  const activePlanId = planOptions.length > 0 ? selectedPlanId : (planId ?? '');

  useEffect(() => {
    const nextMemberId = readSubjectMemberId(selectionStorageKey, members);
    setSelectedMemberId(nextMemberId);
    if (nextMemberId) writeSubjectMemberId(selectionStorageKey, nextMemberId);
  }, [members, selectionStorageKey]);

  useEffect(() => {
    if (plans !== undefined) {
      setLoadedPlans(plans);
      setIsLoadingPlans(false);
      return;
    }
    let active = true;
    setIsLoadingPlans(true);
    setError(null);
    void api
      .listPlans()
      .then((nextPlans) => {
        if (!active) return;
        setIsLoading(true);
        setLoadedPlans(nextPlans);
        setSelectedPlanId((current) =>
          nextPlans.some((plan) => plan.id === current)
            ? current
            : (nextPlans[0]?.id ?? ''),
        );
      })
      .catch((requestError) => {
        if (active) setError(errorMessage(requestError));
      })
      .finally(() => {
        if (active) setIsLoadingPlans(false);
      });
    return () => {
      active = false;
    };
  }, [api, plans]);

  useEffect(() => {
    if (planOptions.length === 0 && planId) {
      setSelectedPlanId(planId);
      return;
    }
    if (!planOptions.some((plan) => plan.id === selectedPlanId))
      setSelectedPlanId(planOptions[0]?.id ?? '');
  }, [planId, planOptions, selectedPlanId]);

  const load = useCallback(async () => {
    if (!activePlanId) {
      setIsLoading(false);
      return false;
    }
    const generation = ++loadGeneration.current;
    const isCurrent = () => generation === loadGeneration.current;
    setIsLoading(true);
    setError(null);
    setNotice(null);
    setSnapshot(null);
    setMetrics(null);
    setDispatch(null);
    try {
      const nextSnapshot = await api.getSnapshot(activePlanId);
      if (!isCurrent()) return false;
      setSnapshot(nextSnapshot);
      setPlanTitle(nextSnapshot.plan.title);
      setPlanDepartureAt(toDateTimeLocal(nextSnapshot.plan.departureAt));
      setPlanPickupMapsUrl(nextSnapshot.plan.pickupMapsUrl ?? '');
      setPlanDestinationMapsUrl(nextSnapshot.plan.destinationMapsUrl ?? '');
      if (isManager) {
        const [nextMetrics, nextDispatch] = await Promise.all([
          api.getMetrics(activePlanId),
          api.getDispatch(activePlanId),
        ]);
        if (!isCurrent()) return false;
        setMetrics(nextMetrics);
        setDispatch(nextDispatch);
      }
      return true;
    } catch (requestError) {
      if (isCurrent()) setError(errorMessage(requestError));
      return false;
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, [activePlanId, api, isManager]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activePlanId) return;
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
      await api.createOffer(activePlanId, {
        capacity: parsedCapacity,
        ...(driverDisplayName.trim()
          ? { driverDisplayName: driverDisplayName.trim() }
          : {}),
      });
      setCapacity('');
      if (await load()) setNotice('車の登録を受け付けました。');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  async function submitDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = driverDisplayName.trim();
    if (!normalizedName || normalizedName.length > 200) {
      setError('配車表に表示する名前を1〜200文字で入力してください。');
      return;
    }
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.setDisplayName({ displayName: normalizedName });
      setDriverDisplayName(result.displayName);
      setNotice('配車表の表示名を保存しました。');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activePlanId) return;
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
      await api.createRequest(activePlanId, {
        subjectMemberId: selectedMemberId,
        passengerCount: parsedCount,
      });
      if (await load()) setNotice('乗車希望を登録しました。');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  async function autoMatch() {
    if (!activePlanId) return;
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.autoMatch(activePlanId);
      if (await load())
        setNotice(
          `割当${result.assignments.length}件、未割当${result.unassignedRequestIds.length}件を反映しました。`,
        );
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  async function transitionPlan(action: RidePlanTransitionInput['action']) {
    if (!activePlanId || !snapshot) return;
    if (action === 'reopen' && !transitionReasonCode) {
      setError('再編集理由を入力してください。');
      return;
    }
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const input: RidePlanTransitionInput =
        action === 'reopen'
          ? {
              action,
              reasonCode: transitionReasonCode as
                | 'schedule_change'
                | 'member_change'
                | 'vehicle_change'
                | 'other',
            }
          : { action };
      const nextPlan = await api.transitionPlan(activePlanId, input);
      setTransitionReasonCode('');
      if (await load()) {
        setLoadedPlans((current) =>
          current.map((plan) => (plan.id === nextPlan.id ? nextPlan : plan)),
        );
        setNotice(
          action === 'close'
            ? '受付を終了しました。'
            : action === 'finalize'
              ? '配車表を公開しました。'
              : '再編集を開始しました。',
        );
      }
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activePlanId || !selectedRequestId || !selectedOfferId) {
      setError('乗車希望と車を選択してください。');
      return;
    }
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.assign(activePlanId, {
        requestId: selectedRequestId,
        offerId: selectedOfferId,
        expectedOfferId:
          dispatch?.assignments.find(
            (assignment) => assignment.requestId === selectedRequestId,
          )?.offerId ?? null,
      });
      if (await load()) setNotice('手動割当を反映しました。');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  async function submitPlanUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activePlanId || !planTitle.trim() || !planDepartureAt) {
      setError('送迎予定のタイトルと出発日時を入力してください。');
      return;
    }
    const input: RidePlanUpdateInput = {
      title: planTitle,
      departureAt: new Date(planDepartureAt).toISOString(),
      pickupMapsUrl: planPickupMapsUrl || null,
      destinationMapsUrl: planDestinationMapsUrl || null,
    };
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const nextPlan = await api.updatePlan(activePlanId, input);
      if (await load()) {
        setLoadedPlans((current) =>
          current.map((plan) => (plan.id === nextPlan.id ? nextPlan : plan)),
        );
        setNotice('送迎予定を更新しました。');
      }
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  function requestConfirmation(action: ConfirmableRideAction) {
    if (
      action.kind === 'transition' &&
      action.action === 'reopen' &&
      !transitionReasonCode
    ) {
      setError('再編集理由を入力してください。');
      return;
    }
    setError(null);
    setConfirmation(action);
  }

  async function confirmAction() {
    const action = confirmation;
    setConfirmation(null);
    if (!action) return;
    if (action.kind === 'match') return autoMatch();
    return transitionPlan(action.action);
  }

  if (planOptions.length > 0) {
    // 予定一覧は既存の中央API契約の呼び出し元から渡し、送迎APIに未定義の一覧エンドポイントを追加しない。
    return (
      <section aria-labelledby="ride-plan-selection-heading">
        <h1 id="ride-plan-selection-heading">送迎</h1>
        <label htmlFor="ride-plan-select">送迎予定を選択</label>
        <Select
          id="ride-plan-select"
          value={activePlanId}
          onChange={(event) => {
            loadGeneration.current += 1;
            setSelectedPlanId(event.target.value);
            setIsLoading(true);
            setSnapshot(null);
            setMetrics(null);
            setDispatch(null);
            setSelectedRequestId('');
            setSelectedOfferId('');
            setError(null);
            setNotice(null);
          }}
        >
          {planOptions.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.title}（{new Date(plan.departureAt).toLocaleString('ja-JP')}
              ）
            </option>
          ))}
        </Select>
        {activePlanId && isLoading && !snapshot ? (
          <p role="status">送迎情報を読み込み中…</p>
        ) : null}
        {activePlanId && !isLoading && !snapshot
          ? renderRideOperations()
          : null}
        {activePlanId && snapshot ? renderRideOperations() : null}
      </section>
    );
  }

  if (!activePlanId)
    return (
      <p role="status">
        {isLoadingPlans
          ? '送迎予定を読み込み中…'
          : (error ?? '送迎予定がありません。')}
      </p>
    );
  if (isLoading && !snapshot) return <p role="status">送迎情報を読み込み中…</p>;
  if (!snapshot)
    return (
      <div>
        <p role="alert">{error ?? '送迎情報を表示できません。'}</p>
        <Button type="button" disabled={isLoading} onClick={() => void load()}>
          再試行
        </Button>
      </div>
    );

  return renderRideOperations();

  function renderRideOperations() {
    if (!snapshot)
      return (
        <div>
          <p role="alert">{error ?? '送迎情報を表示できません。'}</p>
          {activePlanId ? (
            <Button
              type="button"
              disabled={isLoading}
              onClick={() => void load()}
            >
              再試行
            </Button>
          ) : null}
        </div>
      );
    return (
      <Card aria-labelledby="ride-operations-heading">
        <h1 id="ride-operations-heading">送迎</h1>
        <p>
          {snapshot.plan.title}（出発{' '}
          {new Date(snapshot.plan.departureAt).toLocaleString('ja-JP')}）
        </p>
        <Badge
          variant={
            snapshot.plan.status === 'finalized' ? 'success' : 'secondary'
          }
        >
          状態：{planStatusLabel(snapshot.plan.status)}
        </Badge>
        <section aria-labelledby="ride-profile-heading">
          <h2 id="ride-profile-heading">配車表の表示名</h2>
          <p>自分が運転する車の配車表に表示する名前を設定します。</p>
          <form onSubmit={submitDisplayName}>
            <label htmlFor="ride-driver-display-name">表示名</label>
            <Input
              id="ride-driver-display-name"
              maxLength={200}
              value={driverDisplayName}
              onChange={(event) => setDriverDisplayName(event.target.value)}
              placeholder="例：山田 太郎"
            />
            <Button type="submit" disabled={isSaving}>
              表示名を保存
            </Button>
          </form>
        </section>
        {isManager || snapshot.plan.status === 'finalized' ? (
          <p>
            <SafeMapsLink
              url={snapshot.plan.pickupMapsUrl}
              label="集合場所を地図で開く"
              missingMessage="集合場所の地図は未設定。運営に確認"
            />{' '}
            <SafeMapsLink
              url={snapshot.plan.destinationMapsUrl}
              label="目的地を地図で開く"
            />
          </p>
        ) : (
          <p role="status">集合場所と配車結果は確定公開後に表示します。</p>
        )}

        {snapshot.plan.status === 'open' ? (
          <>
            <section aria-labelledby="ride-offer-heading">
              <h2 id="ride-offer-heading">車を出す</h2>
              <form onSubmit={submitOffer}>
                <label htmlFor="ride-capacity">乗車可能数</label>
                <Input
                  id="ride-capacity"
                  inputMode="numeric"
                  min="1"
                  max="20"
                  type="number"
                  value={capacity}
                  onChange={(event) => setCapacity(event.target.value)}
                />
                <Button type="submit" disabled={isSaving}>
                  登録する
                </Button>
              </form>
            </section>

            <section aria-labelledby="ride-request-heading">
              <h2 id="ride-request-heading">乗車を希望する</h2>
              {members.length === 0 ? (
                <p>担当できる部員がいないため、乗車希望を登録できません。</p>
              ) : (
                <form onSubmit={submitRequest}>
                  <label htmlFor="ride-member">部員</label>
                  <Select
                    id="ride-member"
                    value={selectedMemberId}
                    onChange={(event) => {
                      setSelectedMemberId(event.target.value);
                      writeSubjectMemberId(
                        selectionStorageKey,
                        event.target.value,
                      );
                    }}
                  >
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.label}
                      </option>
                    ))}
                  </Select>
                  <label htmlFor="ride-passenger-count">人数</label>
                  <Input
                    id="ride-passenger-count"
                    inputMode="numeric"
                    min="1"
                    max="8"
                    type="number"
                    value={passengerCount}
                    onChange={(event) => setPassengerCount(event.target.value)}
                  />
                  <Button type="submit" disabled={isSaving}>
                    登録する
                  </Button>
                </form>
              )}
            </section>
          </>
        ) : (
          <p role="status">現在は乗車希望の受付を停止しています。</p>
        )}

        <section aria-labelledby="ride-result-heading">
          <h2 id="ride-result-heading">
            {isManager ? '割当結果' : '申込状況'}
          </h2>
          {!isManager && snapshot.plan.status !== 'finalized' ? (
            <p role="status">配車結果は確定公開後に表示します。</p>
          ) : snapshot.requests.length === 0 ? (
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
          {!isManager ? (
            <GuardianConfirmedAssignments
              status={snapshot.plan.status}
              assignments={snapshot.confirmedAssignments ?? []}
            />
          ) : null}
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
            {snapshot.plan.status !== 'finalized' ? (
              <form onSubmit={submitPlanUpdate}>
                <h3>送迎予定を編集</h3>
                <label htmlFor="ride-plan-title">タイトル</label>
                <Input
                  id="ride-plan-title"
                  value={planTitle}
                  maxLength={200}
                  onChange={(event) => setPlanTitle(event.target.value)}
                />
                <label htmlFor="ride-plan-departure">出発日時</label>
                <Input
                  id="ride-plan-departure"
                  type="datetime-local"
                  value={planDepartureAt}
                  onChange={(event) => setPlanDepartureAt(event.target.value)}
                />
                <label htmlFor="ride-plan-pickup-maps">集合場所Maps URL</label>
                <Input
                  id="ride-plan-pickup-maps"
                  type="url"
                  value={planPickupMapsUrl}
                  onChange={(event) => setPlanPickupMapsUrl(event.target.value)}
                />
                <label htmlFor="ride-plan-destination-maps">
                  目的地Maps URL
                </label>
                <Input
                  id="ride-plan-destination-maps"
                  type="url"
                  value={planDestinationMapsUrl}
                  onChange={(event) =>
                    setPlanDestinationMapsUrl(event.target.value)
                  }
                />
                <Button type="submit" disabled={isSaving}>
                  予定を保存
                </Button>
              </form>
            ) : null}
            <section aria-labelledby="ride-lifecycle-heading">
              <h3 id="ride-lifecycle-heading">公開状態</h3>
              {snapshot.plan.status === 'open' ? (
                <Button
                  type="button"
                  disabled={isSaving}
                  onClick={() =>
                    requestConfirmation({ kind: 'transition', action: 'close' })
                  }
                >
                  受付を終了
                </Button>
              ) : null}
              {snapshot.plan.status === 'closed' ? (
                <Button
                  type="button"
                  disabled={isSaving}
                  onClick={() =>
                    requestConfirmation({
                      kind: 'transition',
                      action: 'finalize',
                    })
                  }
                >
                  配車表を確定して公開
                </Button>
              ) : null}
              {snapshot.plan.status === 'finalized' ? (
                <>
                  <label htmlFor="ride-reopen-reason">再編集理由</label>
                  <Select
                    id="ride-reopen-reason"
                    value={transitionReasonCode}
                    onChange={(event) =>
                      setTransitionReasonCode(event.target.value)
                    }
                  >
                    <option value="">選択してください</option>
                    <option value="schedule_change">日程・場所の変更</option>
                    <option value="member_change">部員・人数の変更</option>
                    <option value="vehicle_change">車・配車の変更</option>
                    <option value="other">その他</option>
                  </Select>
                  <Button
                    type="button"
                    disabled={isSaving}
                    onClick={() =>
                      requestConfirmation({
                        kind: 'transition',
                        action: 'reopen',
                      })
                    }
                  >
                    公開後の変更を開始
                  </Button>
                </>
              ) : null}
            </section>
            {snapshot.plan.status !== 'finalized' ? (
              <Button
                type="button"
                disabled={isSaving}
                onClick={() => requestConfirmation({ kind: 'match' })}
              >
                補助マッチングを実行
              </Button>
            ) : null}
            {metrics ? <Metrics metrics={metrics} /> : null}
            {dispatch &&
            (snapshot.plan.status === 'open' ||
              snapshot.plan.status === 'closed') ? (
              <form onSubmit={submitAssignment}>
                <h3>手動割当</h3>
                <label htmlFor="ride-request-select">乗車希望</label>
                <Select
                  id="ride-request-select"
                  value={selectedRequestId}
                  onChange={(event) => setSelectedRequestId(event.target.value)}
                >
                  <option value="">選択してください</option>
                  {dispatch.requests
                    .filter(
                      (request) =>
                        request.status === 'pending' ||
                        request.status === 'unassigned' ||
                        request.status === 'assigned',
                    )
                    .map((request) => (
                      <option key={request.id} value={request.id}>
                        {request.id}（{request.passengerCount}人）
                      </option>
                    ))}
                </Select>
                <label htmlFor="ride-offer-select">車</label>
                <Select
                  id="ride-offer-select"
                  value={selectedOfferId}
                  onChange={(event) => setSelectedOfferId(event.target.value)}
                >
                  <option value="">選択してください</option>
                  {dispatch.offers
                    .filter((offer) => offer.status === 'open')
                    .map((offer) => (
                      <option key={offer.id} value={offer.id}>
                        {offer.driverUserId}（定員{offer.capacity}人）
                      </option>
                    ))}
                </Select>
                <Button type="submit" disabled={isSaving}>
                  割り当てる
                </Button>
              </form>
            ) : null}
            {dispatch ? (
              <Table>
                <caption>配車表</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead>運転者識別子</TableHead>
                    <TableHead>乗車希望識別子</TableHead>
                    <TableHead>人数</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dispatch.assignments.map((assignment) => {
                    const offer = dispatch.offers.find(
                      (item) => item.id === assignment.offerId,
                    );
                    return (
                      <TableRow key={assignment.id}>
                        <TableCell>{offer?.driverUserId ?? '不明'}</TableCell>
                        <TableCell>{assignment.requestId}</TableCell>
                        <TableCell>{assignment.passengerCount}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : null}
          </section>
        ) : null}

        {confirmation ? (
          <Card
            role="dialog"
            aria-modal="true"
            aria-labelledby="ride-confirmation-heading"
          >
            <h3 id="ride-confirmation-heading">操作を確認</h3>
            <p>
              {confirmation.kind === 'match'
                ? '現在の希望と車の情報で補助マッチングを実行します。'
                : confirmation.action === 'close'
                  ? '受付を終了し、内容確認の状態へ移します。'
                  : confirmation.action === 'finalize'
                    ? '配車表を確定し、担当者へ公開します。'
                    : '公開後の変更を開始し、再確認の状態へ戻します。'}
            </p>
            <Button
              type="button"
              disabled={isSaving}
              onClick={() => void confirmAction()}
            >
              実行する
            </Button>{' '}
            <Button
              type="button"
              disabled={isSaving}
              onClick={() => setConfirmation(null)}
            >
              キャンセル
            </Button>
          </Card>
        ) : null}

        {error ? (
          <Alert variant="destructive" role="alert">
            {error}
          </Alert>
        ) : null}
        {notice ? <Alert role="status">{notice}</Alert> : null}
      </Card>
    );
  }
}
