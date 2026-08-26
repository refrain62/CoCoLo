import type { TeamOption } from '@cocolo/contracts/auth-team-selection';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CoCoLoLogoMark,
  EmptyState,
  Section,
} from '@cocolo/ui';
import { isAdminRouteVisible } from './admin-routes.js';
import type { AuthRole } from './auth-context-api.js';
import type { FeatureContractSnapshot } from './features/feature-contract/feature-contract-api.js';

const roleLabels: Record<AuthRole, string> = {
  owner: 'オーナー',
  admin: '管理者',
  staff: 'スタッフ',
  guardian: '保護者',
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

export function AdminDashboard({
  contract,
  onNavigate,
  role,
  team,
}: {
  contract: FeatureContractSnapshot;
  onNavigate: (path: string) => void;
  role: AuthRole;
  team: TeamOption;
}) {
  const enabledCount = contract.features.filter(
    (feature) => feature.enabled,
  ).length;
  const paidCount = contract.features.filter(
    (feature) => feature.billingType === 'paid' && feature.enabled,
  ).length;
  const canNavigate = (route: Parameters<typeof isAdminRouteVisible>[0]) =>
    isAdminRouteVisible(route, role, contract.features);

  return (
    <div className="admin-page-stack">
      <Section
        eyebrow="Overview"
        title={`${team.tenantName}の運営状況`}
        description={`${roleLabels[role]}として、今日の確認が必要な情報をまとめています。`}
        actions={
          <Button
            variant="outline"
            onClick={() => onNavigate('/admin/members')}
          >
            メンバーを確認
          </Button>
        }
      >
        <div className="admin-hero-card">
          <div>
            <p className="admin-hero-kicker">チーム運営をひとつの場所で</p>
            <h1>次の活動に集中できる状態をつくる</h1>
            <p>
              予定、メンバー、回覧、購買の状況を画面ごとに確認できます。
              権限と契約に応じたメニューだけを表示しています。
            </p>
          </div>
          <div className="admin-hero-mark" aria-hidden="true">
            <CoCoLoLogoMark className="admin-hero-logo" />
          </div>
        </div>
      </Section>

      <div className="admin-metric-grid">
        <Card className="admin-metric-card">
          <CardHeader>
            <CardDescription>利用できる機能</CardDescription>
            <CardTitle>{enabledCount}個</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="success">契約を確認済み</Badge>
          </CardContent>
        </Card>
        <Card className="admin-metric-card">
          <CardHeader>
            <CardDescription>有償機能</CardDescription>
            <CardTitle>{paidCount}個</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={paidCount > 0 ? 'default' : 'secondary'}>
              {paidCount > 0 ? '利用中' : '未契約'}
            </Badge>
          </CardContent>
        </Card>
        <Card className="admin-metric-card">
          <CardHeader>
            <CardDescription>現在のプラン</CardDescription>
            <CardTitle>{contract.planKey ?? '無料プラン'}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">
              {contract.planStatus
                ? planStatusLabels[contract.planStatus]
                : '標準設定'}
            </Badge>
          </CardContent>
        </Card>
      </div>

      <Section
        eyebrow="Quick actions"
        title="よく使う操作"
        description="迷わず次の操作へ進めるよう、主要な画面をまとめています。"
      >
        <div className="admin-action-grid">
          {canNavigate('events') ? (
            <button type="button" onClick={() => onNavigate('/admin/events')}>
              <span className="admin-action-icon" aria-hidden="true">
                ◷
              </span>
              <span>
                <strong>予定と出欠を確認</strong>
                <small>開催予定と未回答を確認</small>
              </span>
              <span aria-hidden="true">→</span>
            </button>
          ) : null}
          {role !== 'guardian' && canNavigate('announcements') ? (
            <button
              type="button"
              onClick={() => onNavigate('/admin/announcements')}
            >
              <span className="admin-action-icon" aria-hidden="true">
                ▤
              </span>
              <span>
                <strong>回覧を掲載</strong>
                <small>チームにお知らせを共有</small>
              </span>
              <span aria-hidden="true">→</span>
            </button>
          ) : null}
          {canNavigate('features') ? (
            <button type="button" onClick={() => onNavigate('/admin/features')}>
              <span className="admin-action-icon" aria-hidden="true">
                ✦
              </span>
              <span>
                <strong>機能契約を確認</strong>
                <small>有効な機能とプランを確認</small>
              </span>
              <span aria-hidden="true">→</span>
            </button>
          ) : null}
        </div>
      </Section>

      <EmptyState
        title="運営情報は各画面で最新状態を取得します"
        description="ダッシュボードは概要に集中し、詳細な一覧や更新操作は専用画面で行います。"
      />
    </div>
  );
}
