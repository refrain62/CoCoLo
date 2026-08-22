import { describe, expect, it } from 'vitest';
import {
  type AuthTeamMembership,
  listSelectableTeams,
  selectTeam,
  TeamSelectionError,
} from '../src/auth-team-selection-domain.ts';

const TEAM_A = '00000000-0000-7000-8000-000000000001';
const TEAM_B = '00000000-0000-7000-8000-000000000002';
const TEAM_C = '00000000-0000-7000-8000-000000000003';

const memberships: AuthTeamMembership[] = [
  {
    tenantId: TEAM_B,
    tenantName: 'ゼットチーム',
    role: 'staff',
    status: 'active',
    createdAt: '2026-08-22T00:00:00.000Z',
  },
  {
    tenantId: TEAM_A,
    tenantName: 'アルファチーム',
    role: 'owner',
    status: 'active',
    createdAt: '2026-08-22T00:00:00.000Z',
  },
  {
    tenantId: TEAM_C,
    tenantName: '停止チーム',
    role: 'admin',
    status: 'suspended',
    createdAt: '2026-08-22T00:00:00.000Z',
  },
  {
    tenantId: '00000000-0000-7000-8000-000000000004',
    tenantName: '招待チーム',
    role: 'guardian',
    status: 'invited',
    createdAt: '2026-08-22T00:00:00.000Z',
  },
];

describe('認証チーム選択の業務ルール', () => {
  it('active所属だけを名前順で選択肢にする', () => {
    expect(listSelectableTeams(memberships)).toEqual([
      { tenantId: TEAM_A, tenantName: 'アルファチーム', role: 'owner' },
      { tenantId: TEAM_B, tenantName: 'ゼットチーム', role: 'staff' },
    ]);
  });

  it('選択のたびに指定tenantとactive状態を検証する', () => {
    expect(selectTeam(memberships, TEAM_B)).toEqual({
      tenantId: TEAM_B,
      tenantName: 'ゼットチーム',
      role: 'staff',
    });
    expect(() => selectTeam(memberships, TEAM_C)).toThrowError(
      new TeamSelectionError(
        'TEAM_NOT_SELECTABLE',
        '選択できるチームではありません。',
      ),
    );
    expect(() =>
      selectTeam(memberships, TEAM_A.replace('7', '4')),
    ).toThrowError(
      new TeamSelectionError(
        'INVALID_TEAM_ID',
        'チームIDはUUIDv7で指定してください。',
      ),
    );
  });
});
