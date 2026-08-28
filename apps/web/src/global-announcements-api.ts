import {
  getStoredSelectedTeamId,
  selectedTeamHeaderName,
} from './features/auth-team-selection/selected-team-storage.js';
import type { SystemAnnouncement } from './system-admin-api.js';

export class GlobalAnnouncementsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GlobalAnnouncementsApiError';
  }
}

type GlobalAnnouncementsApiOptions = {
  baseUrl?: string;
  getAccessToken: () => string | null;
  getSelectedTeamId?: () => string | null;
  fetcher?: typeof fetch;
};

type ErrorResponse = { error?: { code?: string; message?: string } };

export type GlobalAnnouncementsApi = ReturnType<
  typeof createGlobalAnnouncementsApi
>;

export function createGlobalAnnouncementsApi({
  baseUrl = import.meta.env.VITE_API_URL ?? '',
  getAccessToken,
  getSelectedTeamId = getStoredSelectedTeamId,
  fetcher = fetch,
}: GlobalAnnouncementsApiOptions) {
  return {
    async list(): Promise<SystemAnnouncement[]> {
      const token = getAccessToken();
      if (!token)
        throw new GlobalAnnouncementsApiError(
          401,
          'UNAUTHENTICATED',
          'ログインが必要です。',
        );
      const selectedTeamId = getSelectedTeamId();
      const response = await fetcher(
        `${baseUrl.replace(/\/$/u, '')}/api/v1/global-announcements`,
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            ...(selectedTeamId
              ? { [selectedTeamHeaderName]: selectedTeamId }
              : {}),
          },
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ErrorResponse;
        throw new GlobalAnnouncementsApiError(
          response.status,
          body.error?.code ?? 'REQUEST_FAILED',
          body.error?.message ?? 'システムからのお知らせを取得できません。',
        );
      }
      return ((await response.json()) as { data: SystemAnnouncement[] }).data;
    },
  };
}
