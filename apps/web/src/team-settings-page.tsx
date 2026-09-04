import type { TeamOption } from '@cocolo/contracts/auth-team-selection';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Section,
} from '@cocolo/ui';
import { adminNavigation } from './admin-routes.js';
import type { AuthRole } from './auth-context-api.js';

const roleLabels: Record<AuthRole, string> = {
  owner: 'オーナー',
  admin: '管理者',
  staff: 'スタッフ',
  guardian: '保護者',
};

const settingsLinks = [
  {
    route: 'features' as const,
    icon: '✦',
    title: '機能契約',
    description: '有償・無償機能とチームごとのfeature flagを管理',
  },
  {
    route: 'board-contacts' as const,
    icon: '◎',
    title: '役員・連絡先',
    description: '年度の役職枠と公開範囲を管理',
  },
];

/** チーム全体の設定概要を表示し、個別の管理画面へ責務を分けて案内します。 */
export function TeamSettingsPage({
  onNavigate,
  role,
  team,
}: {
  onNavigate: (path: string) => void;
  role: AuthRole;
  team: TeamOption;
}) {
  return (
    <div className="admin-page-stack">
      <Section
        eyebrow="Team settings"
        title="チーム設定"
        description="チームの基本情報と、個別に管理する設定画面への導線をまとめています。"
      >
        <div className="admin-hero-card">
          <div>
            <p className="admin-hero-kicker">現在のチーム</p>
            <h1>{team.tenantName}</h1>
            <p>あなたの権限は「{roleLabels[role]}」です。</p>
          </div>
          <div className="admin-hero-mark" aria-hidden="true">
            {team.tenantName.slice(0, 1).toUpperCase()}
          </div>
        </div>
      </Section>

      <Section
        eyebrow="Manage separately"
        title="設定を選択"
        description="設定の変更は、それぞれの画面で対象と影響範囲を確認してから行います。"
      >
        <div className="admin-action-grid">
          {settingsLinks.map((link) => {
            const item = adminNavigation.find(
              (candidate) => candidate.route === link.route,
            );
            if (!item) return null;
            return (
              <Button
                key={link.route}
                className="admin-action-button"
                variant="outline"
                onClick={() => onNavigate(item.href)}
              >
                <span className="admin-action-icon" aria-hidden="true">
                  {link.icon}
                </span>
                <span>
                  <strong>{link.title}</strong>
                  <small>{link.description}</small>
                </span>
                <span aria-hidden="true">→</span>
              </Button>
            );
          })}
        </div>
      </Section>

      <Card>
        <CardHeader>
          <CardTitle>権限の目安</CardTitle>
          <CardDescription>
            画面に表示される情報と操作は、チーム内の役割に応じて制限されます。
          </CardDescription>
        </CardHeader>
        <CardContent className="admin-role-summary">
          <Badge variant="success">{roleLabels[role]}</Badge>
          <p>
            必要な操作が表示されない場合は、チームのオーナーまたは管理者へ
            確認してください。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
