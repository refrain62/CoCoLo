import type { TeamOption } from '@cocolo/contracts/auth-team-selection';

const roleLabels: Record<TeamOption['role'], string> = {
  owner: 'オーナー',
  admin: '管理者',
  staff: 'スタッフ',
  guardian: '保護者',
};

export function SelectedTeamHeader({ team }: { team: TeamOption }) {
  return (
    <header>
      <h2 className="visually-hidden">選択中のチーム</h2>
      <span>選択中のチーム: {team.tenantName}</span>
      <span>役割: {roleLabels[team.role]}</span>
    </header>
  );
}
