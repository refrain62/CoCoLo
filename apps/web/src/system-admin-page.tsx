import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Section,
} from '@cocolo/ui';
import type { SystemAdminRoute } from './system-admin-routes.js';

export function SystemAdminPage({
  onNavigate,
  route,
}: {
  onNavigate: (path: string) => void;
  route: SystemAdminRoute;
}) {
  if (route === 'notices')
    return (
      <div className="admin-page-stack">
        <header className="admin-route-header">
          <p className="admin-eyebrow">Platform notices</p>
          <h1>全体お知らせ</h1>
          <p>すべてのチームへ届けるお知らせを管理します。</p>
        </header>
        <section className="system-admin-placeholder" role="status">
          <strong>全体お知らせの管理APIを準備中です。</strong>
          <span>
            この画面はsystem
            adminだけが表示できます。公開・編集機能は、監査ログと公開期間を含む専用API接続後に有効化します。
          </span>
        </section>
      </div>
    );

  if (route === 'entitlements')
    return (
      <div className="admin-page-stack">
        <header className="admin-route-header">
          <p className="admin-eyebrow">Entitlements</p>
          <h1>有償機能</h1>
          <p>課金契約に基づく有償機能の提供状態を確認します。</p>
        </header>
        <section className="system-admin-placeholder" role="status">
          <strong>有償機能の管理APIを準備中です。</strong>
          <span>
            有償機能は課金providerの承認台帳と連動するため、画面上の単純な切り替えでは付与しません。
          </span>
        </section>
      </div>
    );

  return (
    <div className="admin-page-stack">
      <Section
        eyebrow="System overview"
        title="システム管理"
        description="全体のお知らせと、有償機能の提供状態を管理する入口です。"
      >
        <div className="admin-hero-card">
          <div>
            <p className="admin-hero-kicker">SYSTEM ADMIN ONLY</p>
            <h1>CoCoLo全体の運用を安全に管理する</h1>
            <p>
              チーム管理とは分離されたシステム管理領域です。操作の実装後も、
              課金と監査の境界を保ったまま運用します。
            </p>
          </div>
          <Badge variant="success">認証済み</Badge>
        </div>
      </Section>
      <div className="admin-metric-grid system-admin-card-grid">
        <Card>
          <CardHeader>
            <CardTitle>全体お知らせ</CardTitle>
          </CardHeader>
          <CardContent>
            <p>利用者へ告知する内容を管理</p>
            <button
              className="dashboard-text-link"
              type="button"
              onClick={() => onNavigate('/admin/notices')}
            >
              管理画面を開く →
            </button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>有償機能</CardTitle>
          </CardHeader>
          <CardContent>
            <p>契約と提供状態を確認</p>
            <button
              className="dashboard-text-link"
              type="button"
              onClick={() => onNavigate('/admin/entitlements')}
            >
              管理画面を開く →
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
