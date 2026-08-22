import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  createOrdersPaymentsApi,
  type OrdersCampaign,
  type OrdersEntry,
  type OrdersPaymentsApi,
  type OrdersSummary,
} from './orders-payments-api.js';

type OrdersRole = 'owner' | 'admin' | 'staff' | 'guardian';

export type OrdersMemberChoice = { id: string; name: string };

const defaultApi = createOrdersPaymentsApi({
  getAccessToken: () =>
    typeof window === 'undefined'
      ? null
      : window.localStorage.getItem('cocolo.accessToken'),
});

function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : '共同購買の処理に失敗しました。';
}

/**
 * 共同購買の保護者注文と管理者集計を同じ画面状態で扱う。
 * 権限判定は表示補助に留め、保存操作の認可はAPIで再検証する。
 */
export function OrdersPaymentsPage({
  api = defaultApi,
  role,
  members = [],
}: {
  api?: OrdersPaymentsApi;
  role: OrdersRole;
  members?: OrdersMemberChoice[];
}) {
  const [campaigns, setCampaigns] = useState<OrdersCampaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [entries, setEntries] = useState<OrdersEntry[]>([]);
  const [summary, setSummary] = useState<OrdersSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadCampaigns = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const next = await api.listCampaigns();
      setCampaigns(next);
      setSelectedCampaignId((current) => current || next[0]?.id || '');
    } catch (requestError) {
      setError(message(requestError));
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  const loadDetails = useCallback(
    async (campaignId: string) => {
      if (!campaignId) return;
      try {
        const nextEntries = await api.listEntries(campaignId);
        setEntries(nextEntries);
        if (role === 'owner' || role === 'admin')
          setSummary(await api.getSummary(campaignId));
      } catch (requestError) {
        setError(message(requestError));
      }
    },
    [api, role],
  );

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  useEffect(() => {
    void loadDetails(selectedCampaignId);
  }, [loadDetails, selectedCampaignId]);

  const selectedCampaign = useMemo(
    () =>
      campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null,
    [campaigns, selectedCampaignId],
  );

  async function updatePayment(entry: OrdersEntry) {
    if (!selectedCampaignId) return;
    setError(null);
    try {
      await api.updatePayment(
        selectedCampaignId,
        entry.id,
        entry.paymentStatus === 'paid' ? 'unpaid' : 'paid',
      );
      await loadDetails(selectedCampaignId);
      setSuccess('支払状態を更新しました。');
    } catch (requestError) {
      setError(message(requestError));
    }
  }

  async function downloadCsv() {
    if (!selectedCampaignId) return;
    try {
      const blob = await api.exportCsv(selectedCampaignId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'orders.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(message(requestError));
    }
  }

  return (
    <main>
      <header>
        <h1>共同購買・集金</h1>
        <p>注文の入力と集金状態を確認できます。</p>
      </header>
      {isLoading ? <p role="status">読み込み中…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {success ? <p role="status">{success}</p> : null}
      {role === 'owner' || role === 'admin' ? (
        <CampaignForm
          api={api}
          onCreated={(campaign) => {
            setCampaigns((current) => [campaign, ...current]);
            setSelectedCampaignId(campaign.id);
          }}
        />
      ) : null}
      {!isLoading && campaigns.length === 0 ? (
        <p>募集中の商品はありません。</p>
      ) : null}
      {campaigns.length > 0 ? (
        <section aria-labelledby="orders-campaign-heading">
          <h2 id="orders-campaign-heading">募集案件</h2>
          <label htmlFor="orders-campaign-select">案件を選択</label>
          <select
            id="orders-campaign-select"
            value={selectedCampaignId}
            onChange={(event) => setSelectedCampaignId(event.target.value)}
          >
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.title}
              </option>
            ))}
          </select>
          {selectedCampaign && role === 'guardian' ? (
            <EntryForm
              api={api}
              campaign={selectedCampaign}
              members={members}
              onCreated={(entry) =>
                setEntries((current) => [entry, ...current])
              }
            />
          ) : null}
          {selectedCampaign && (role === 'owner' || role === 'admin') ? (
            <ManagerPanel
              entries={entries}
              summary={summary}
              onPayment={updatePayment}
              onCsv={downloadCsv}
            />
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

function CampaignForm({
  api,
  onCreated,
}: {
  api: OrdersPaymentsApi;
  onCreated: (campaign: OrdersCampaign) => void;
}) {
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [productName, setProductName] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [optionValues, setOptionValues] = useState('');
  const [requiresBackNumber, setRequiresBackNumber] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      const campaign = await api.createCampaign({
        title,
        deadline: new Date(deadline).toISOString(),
        products: [
          {
            name: productName,
            unitPrice: Number(unitPrice),
            options: optionValues.trim()
              ? [
                  {
                    name: 'サイズ',
                    values: optionValues
                      .split(',')
                      .map((value) => value.trim())
                      .filter(Boolean),
                  },
                ]
              : [],
            requiresBackNumber,
            requiresBackName: false,
          },
        ],
      });
      onCreated(campaign);
      setTitle('');
      setProductName('');
      setUnitPrice('');
      setOptionValues('');
    } catch (requestError) {
      setError(message(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section aria-labelledby="orders-campaign-create-heading">
      <h2 id="orders-campaign-create-heading">募集案件を登録</h2>
      <form onSubmit={submit}>
        <label htmlFor="orders-title">案件名</label>
        <input
          id="orders-title"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <label htmlFor="orders-deadline">注文締切</label>
        <input
          id="orders-deadline"
          required
          type="datetime-local"
          value={deadline}
          onChange={(event) => setDeadline(event.target.value)}
        />
        <label htmlFor="orders-product-name">商品名</label>
        <input
          id="orders-product-name"
          required
          value={productName}
          onChange={(event) => setProductName(event.target.value)}
        />
        <label htmlFor="orders-unit-price">単価（円）</label>
        <input
          id="orders-unit-price"
          required
          min="0"
          type="number"
          value={unitPrice}
          onChange={(event) => setUnitPrice(event.target.value)}
        />
        <label htmlFor="orders-option-values">
          サイズ（カンマ区切り、任意）
        </label>
        <input
          id="orders-option-values"
          value={optionValues}
          onChange={(event) => setOptionValues(event.target.value)}
        />
        <label>
          <input
            checked={requiresBackNumber}
            type="checkbox"
            onChange={(event) => setRequiresBackNumber(event.target.checked)}
          />
          背番号を入力する
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button disabled={isSaving} type="submit">
          {isSaving ? '登録中…' : '募集案件を登録'}
        </button>
      </form>
    </section>
  );
}

function EntryForm({
  api,
  campaign,
  members,
  onCreated,
}: {
  api: OrdersPaymentsApi;
  campaign: OrdersCampaign;
  members: OrdersMemberChoice[];
  onCreated: (entry: OrdersEntry) => void;
}) {
  const [memberId, setMemberId] = useState(members[0]?.id ?? '');
  const [ordererName, setOrdererName] = useState('');
  const [productId, setProductId] = useState(campaign.products[0]?.id ?? '');
  const [selectedOptions, setSelectedOptions] = useState<
    Record<string, string>
  >({});
  const [quantity, setQuantity] = useState('1');
  const [backNumber, setBackNumber] = useState('');
  const [backName, setBackName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const product =
    campaign.products.find((candidate) => candidate.id === productId) ??
    campaign.products[0];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!product) return;
    setError(null);
    setSuccess(null);
    try {
      const entry = await api.createEntry(campaign.id, {
        memberId,
        ordererName,
        lines: [
          {
            productId: product.id,
            quantity: Number(quantity),
            selectedOptions,
            backNumber: backNumber || null,
            backName: backName || null,
          },
        ],
      });
      onCreated(entry);
      setSuccess('注文を登録しました。');
    } catch (requestError) {
      setError(message(requestError));
    }
  }

  return (
    <form aria-labelledby="orders-entry-heading" onSubmit={submit}>
      <h3 id="orders-entry-heading">注文を入力</h3>
      <label htmlFor="orders-member">対象部員</label>
      <select
        id="orders-member"
        required
        value={memberId}
        onChange={(event) => setMemberId(event.target.value)}
      >
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>
      <label htmlFor="orders-orderer-name">注文者名</label>
      <input
        id="orders-orderer-name"
        required
        value={ordererName}
        onChange={(event) => setOrdererName(event.target.value)}
      />
      <label htmlFor="orders-product">商品</label>
      <select
        id="orders-product"
        required
        value={product?.id ?? ''}
        onChange={(event) => {
          setProductId(event.target.value);
          setSelectedOptions({});
        }}
      >
        {campaign.products.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}（{candidate.unitPrice}円）
          </option>
        ))}
      </select>
      {product?.options.map((option) => (
        <label key={option.name}>
          {option.name}
          <select
            required
            value={selectedOptions[option.name] ?? ''}
            onChange={(event) =>
              setSelectedOptions((current) => ({
                ...current,
                [option.name]: event.target.value,
              }))
            }
          >
            <option value="">選択してください</option>
            {option.values.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label htmlFor="orders-quantity">数量</label>
      <input
        id="orders-quantity"
        min="1"
        required
        type="number"
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
      />
      {product?.requiresBackNumber ? (
        <label htmlFor="orders-back-number">
          背番号
          <input
            id="orders-back-number"
            required
            value={backNumber}
            onChange={(event) => setBackNumber(event.target.value)}
          />
        </label>
      ) : null}
      {product?.requiresBackName ? (
        <label htmlFor="orders-back-name">
          背ネーム
          <input
            id="orders-back-name"
            required
            value={backName}
            onChange={(event) => setBackName(event.target.value)}
          />
        </label>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {success ? <p role="status">{success}</p> : null}
      <button type="submit">注文を登録</button>
    </form>
  );
}

function ManagerPanel({
  entries,
  summary,
  onPayment,
  onCsv,
}: {
  entries: OrdersEntry[];
  summary: OrdersSummary | null;
  onPayment: (entry: OrdersEntry) => Promise<void>;
  onCsv: () => Promise<void>;
}) {
  return (
    <section aria-labelledby="orders-summary-heading">
      <h3 id="orders-summary-heading">集金状況</h3>
      {summary ? (
        <p>
          注文 {summary.totalOrders}件、合計 {summary.totalAmount}円、支払済み{' '}
          {summary.paidAmount}円、未払い {summary.unpaidAmount}円
        </p>
      ) : null}
      <button type="button" onClick={() => void onCsv()}>
        CSVを出力
      </button>
      {entries.length === 0 ? (
        <p>注文はありません。</p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li key={entry.id}>
              {entry.memberName}（{entry.ordererName}）: {entry.totalAmount}円、
              {entry.paymentStatus === 'paid' ? '支払済み' : '未払い'}{' '}
              <button type="button" onClick={() => void onPayment(entry)}>
                {entry.paymentStatus === 'paid'
                  ? '未払いへ戻す'
                  : '支払済みにする'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
