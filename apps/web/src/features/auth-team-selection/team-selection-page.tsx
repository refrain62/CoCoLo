import type { TeamOption } from '@cocolo/contracts/auth-team-selection';
import { useEffect, useState } from 'react';
import { useAuth } from '../../auth-context.js';
import {
  type TeamSelectionApi,
  TeamSelectionApiError,
} from './team-selection-api.js';

export type TeamSelectionPageProps = {
  api: TeamSelectionApi;
  onSelected: (team: TeamOption) => void;
};

const roleLabels: Record<TeamOption['role'], string> = {
  owner: 'オーナー',
  admin: '管理者',
  staff: 'スタッフ',
  guardian: '保護者',
};

// 利用可能なactive所属を選択させ、選択完了前に業務画面へ進ませない。
export function TeamSelectionPage({ api, onSelected }: TeamSelectionPageProps) {
  const { isLoggingOut, logout } = useAuth();
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSelecting, setIsSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    void api
      .list()
      .then((nextTeams) => {
        if (!isCurrent) return;
        setTeams(nextTeams);
        setError(null);
      })
      .catch((requestError: unknown) => {
        if (!isCurrent) return;
        setError(
          requestError instanceof TeamSelectionApiError
            ? requestError.message
            : 'チーム一覧の取得に失敗しました。',
        );
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [api]);

  async function selectTeam() {
    if (!selectedId) return;
    setIsSelecting(true);
    setError(null);
    try {
      const selected = await api.select({ tenantId: selectedId });
      onSelected(selected);
    } catch (requestError) {
      setError(
        requestError instanceof TeamSelectionApiError
          ? requestError.message
          : 'チームの選択に失敗しました。',
      );
    } finally {
      setIsSelecting(false);
    }
  }

  return (
    <main aria-labelledby="team-selection-title">
      <h1 id="team-selection-title">利用するチームを選択</h1>
      <p>操作対象のチームを選択してください。</p>
      <button
        disabled={isLoggingOut}
        onClick={() => void logout()}
        type="button"
      >
        {isLoggingOut ? 'ログアウト中…' : 'ログアウト'}
      </button>
      {isLoading ? <p role="status">チーム一覧を読み込んでいます。</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!isLoading && teams.length > 0 ? (
        <fieldset disabled={isSelecting}>
          <legend className="visually-hidden">チーム一覧</legend>
          {teams.map((team) => (
            <label key={team.tenantId}>
              <input
                checked={selectedId === team.tenantId}
                name="team"
                onChange={() => setSelectedId(team.tenantId)}
                type="radio"
                value={team.tenantId}
              />
              {team.tenantName}（{roleLabels[team.role]}）
            </label>
          ))}
          <button
            disabled={!selectedId || isSelecting}
            onClick={selectTeam}
            type="button"
          >
            {isSelecting ? '選択中…' : 'このチームを利用する'}
          </button>
        </fieldset>
      ) : null}
    </main>
  );
}
