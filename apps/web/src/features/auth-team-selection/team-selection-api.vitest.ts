import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTeamSelectionApi } from './team-selection-api.js';

const TEAM_A = '00000000-0000-7000-8000-000000000001';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('チーム選択API client', () => {
  it('一覧へBearer tokenを付け、active所属DTOだけを受け取る', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ tenantId: TEAM_A, tenantName: 'Aチーム', role: 'owner' }],
        }),
        { status: 200 },
      ),
    );

    const teams = await createTeamSelectionApi({
      getAccessToken: () => 'access-token',
      fetcher,
    }).list();

    expect(teams).toEqual([
      { tenantId: TEAM_A, tenantName: 'Aチーム', role: 'owner' },
    ]);
    expect(fetcher).toHaveBeenCalledWith('/api/v1/auth/teams', {
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer access-token',
      },
    });
  });

  it('選択要求をJSONで送信する', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { tenantId: TEAM_A, tenantName: 'Aチーム', role: 'owner' },
        }),
        { status: 200 },
      ),
    );

    await createTeamSelectionApi({
      getAccessToken: () => 'access-token',
      fetcher,
    }).select({ tenantId: TEAM_A });

    expect(fetcher).toHaveBeenCalledWith('/api/v1/auth/teams/select', {
      method: 'POST',
      body: JSON.stringify({ tenantId: TEAM_A }),
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer access-token',
        'Content-Type': 'application/json',
      },
    });
  });
});
