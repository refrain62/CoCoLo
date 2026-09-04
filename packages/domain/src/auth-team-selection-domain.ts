export type AuthTeamRole = 'owner' | 'admin' | 'staff' | 'guardian';
export type AuthTeamMembershipStatus = 'invited' | 'active' | 'suspended';

export type AuthTeamMembership = {
  tenantId: string;
  tenantName: string;
  role: AuthTeamRole;
  status: AuthTeamMembershipStatus;
  createdAt: Date | string;
};

export type SelectableTeam = {
  tenantId: string;
  tenantName: string;
  role: AuthTeamRole;
};

export type TeamSelectionErrorCode =
  | 'INVALID_TEAM_ID'
  | 'TEAM_NOT_SELECTABLE'
  | 'NO_SELECTABLE_TEAM';

export class TeamSelectionError extends Error {
  constructor(
    readonly code: TeamSelectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TeamSelectionError';
  }
}

const uuidv7Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuidv7(tenantId: string) {
  if (!uuidv7Pattern.test(tenantId))
    throw new TeamSelectionError(
      'INVALID_TEAM_ID',
      'チームIDはUUIDv7で指定してください。',
    );
}

function toSelectableTeam(membership: AuthTeamMembership): SelectableTeam {
  return {
    tenantId: membership.tenantId,
    tenantName: membership.tenantName,
    role: membership.role,
  };
}

// active所属だけを公開し、招待中・停止済みのチームを選択肢へ混ぜない。
export function listSelectableTeams(
  memberships: AuthTeamMembership[],
): SelectableTeam[] {
  return memberships
    .filter((membership) => membership.status === 'active')
    .sort((left, right) => {
      const byName = left.tenantName.localeCompare(right.tenantName, 'ja');
      return byName || left.tenantId.localeCompare(right.tenantId);
    })
    .map(toSelectableTeam);
}

// 選択要求ごとに所属状態を再評価し、利用者入力のtenantIdだけでは認可しない。
export function selectTeam(
  memberships: AuthTeamMembership[],
  tenantId: string,
): SelectableTeam {
  assertUuidv7(tenantId);
  const membership = memberships.find(
    (candidate) => candidate.tenantId === tenantId,
  );
  if (membership?.status !== 'active')
    throw new TeamSelectionError(
      'TEAM_NOT_SELECTABLE',
      '選択できるチームではありません。',
    );
  return toSelectableTeam(membership);
}
