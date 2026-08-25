import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Section,
} from '@cocolo/ui';
import { useCallback, useEffect, useState } from 'react';
import type { AuthRole } from '../../auth-context-api.js';
import {
  type FeatureContractApi,
  FeatureContractApiError,
  type FeatureContractItem,
  type FeatureContractSnapshot,
} from './feature-contract-api.js';

const reasonLabels: Record<FeatureContractItem['reason'], string> = {
  default: '標準で有効',
  flag: 'チーム設定で有効',
  plan: 'プランで有効',
  unavailable: '契約対象外',
};

const planStatusLabels: Record<
  NonNullable<FeatureContractSnapshot['planStatus']>,
  string
> = {
  active: '利用中',
  trialing: 'トライアル中',
  past_due: '支払い確認中',
  canceled: '解約済み',
  expired: '期限切れ',
};

function errorMessage(error: unknown) {
  return error instanceof FeatureContractApiError
    ? error.message
    : '機能契約の取得に失敗しました。';
}

export function FeatureContractPanel({
  api,
  onSnapshotChange,
  role,
}: {
  api: FeatureContractApi;
  onSnapshotChange?: (next: FeatureContractSnapshot) => void;
  role: AuthRole;
}) {
  const [snapshot, setSnapshot] = useState<FeatureContractSnapshot | null>(
    null,
  );
  const [reason, setReason] = useState('チーム設定から変更');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const canManage = role === 'owner' || role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await api.get());
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function update(feature: FeatureContractItem) {
    if (!canManage || feature.billingType !== 'free' || !reason.trim()) return;
    setUpdatingKey(feature.key);
    setError(null);
    try {
      const nextSnapshot = await api.updateFreeFlag({
        featureKey: feature.key,
        enabled: !feature.enabled,
        reason: reason.trim(),
      });
      setSnapshot(nextSnapshot);
      onSnapshotChange?.(nextSnapshot);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setUpdatingKey(null);
    }
  }

  return (
    <div className="admin-page-stack">
      <Section
        eyebrow="Feature contract"
        title="機能契約"
        description="チームのプランとfeature flagから算出された利用可能状態です。利用制限はAPI側でも再確認されます。"
        actions={
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? '更新中…' : '再読み込み'}
          </Button>
        }
      >
        {error ? (
          <Alert variant="destructive" role="alert">
            <strong>機能契約を確認できません</strong>
            <span>{error}</span>
          </Alert>
        ) : null}
        {loading && !snapshot ? (
          <div className="admin-loading-state" role="status" aria-live="polite">
            機能契約を確認しています…
          </div>
        ) : snapshot ? (
          <>
            <div className="feature-plan-summary">
              <div>
                <span className="admin-eyebrow">現在のプラン</span>
                <strong>{snapshot.planKey ?? '無料プラン'}</strong>
              </div>
              <Badge variant={snapshot.planStatus ? 'success' : 'secondary'}>
                {snapshot.planStatus
                  ? planStatusLabels[snapshot.planStatus]
                  : '標準設定'}
              </Badge>
            </div>
            {canManage ? (
              <div className="feature-reason-field">
                <label htmlFor="feature-change-reason">
                  変更理由（無償機能）
                </label>
                <Input
                  id="feature-change-reason"
                  value={reason}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
            ) : null}
            <div className="feature-card-grid">
              {snapshot.features.map((feature) => {
                const isPaid = feature.billingType === 'paid';
                const isUpdating = updatingKey === feature.key;
                return (
                  <Card key={feature.key} className="feature-card">
                    <CardHeader>
                      <div className="feature-card-heading">
                        <CardTitle>{feature.displayName}</CardTitle>
                        <Badge variant={isPaid ? 'outline' : 'secondary'}>
                          {isPaid ? '有償' : '無償'}
                        </Badge>
                      </div>
                      <CardDescription>{feature.key}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="feature-card-status">
                        <span className="feature-status-label">利用状態</span>
                        <Badge
                          variant={feature.enabled ? 'success' : 'destructive'}
                        >
                          {feature.enabled ? '有効' : '無効'}
                        </Badge>
                      </div>
                      <p className="feature-card-reason">
                        {reasonLabels[feature.reason]}
                      </p>
                      <Button
                        className="feature-toggle"
                        variant={feature.enabled ? 'outline' : 'secondary'}
                        disabled={
                          isPaid || !canManage || isUpdating || !reason.trim()
                        }
                        aria-pressed={feature.enabled}
                        onClick={() => void update(feature)}
                      >
                        {isPaid
                          ? 'プランで管理'
                          : isUpdating
                            ? '保存中…'
                            : feature.enabled
                              ? '無効にする'
                              : '有効にする'}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        ) : null}
      </Section>
    </div>
  );
}
