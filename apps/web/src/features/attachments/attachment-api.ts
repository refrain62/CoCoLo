import type { AttachmentMediaType } from '@cocolo/domain/attachment';
import {
  getStoredSelectedTeamId,
  selectedTeamHeaderName,
} from '../auth-team-selection/selected-team-storage.js';

export type UploadSession = {
  attachmentId: string;
  uploadUrl: string;
  expiresAt: string;
  maxBytes: number;
  mediaType: AttachmentMediaType;
};

export type AvailableAttachment = {
  attachmentId: string;
  status: 'available';
  mediaType: AttachmentMediaType;
  byteSize: number;
  sha256: string;
};

export type AttachmentApi = {
  createUploadSession: (input: {
    mediaType: AttachmentMediaType;
    byteSize: number;
  }) => Promise<UploadSession>;
  completeUpload: (input: {
    attachmentId: string;
    sha256: string;
    byteSize: number;
  }) => Promise<AvailableAttachment>;
  createDownloadUrl: (attachmentId: string) => Promise<string>;
};

export class AttachmentApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AttachmentApiError';
  }
}

type ErrorBody = {
  error?: { message?: string };
};

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & ErrorBody;
  if (!response.ok)
    throw new AttachmentApiError(
      response.status,
      body.error?.message ?? '添付操作に失敗しました。',
    );
  return body;
}

// access tokenはAPI呼び出し時だけ付与し、署名URLへのPUTへ認証ヘッダーを転送しない。
export function createAttachmentApi(input: {
  getAccessToken: () => string | null;
  getSelectedTeamId?: () => string | null;
  fetcher?: typeof fetch;
}): AttachmentApi {
  const fetcher = input.fetcher ?? fetch;
  const getSelectedTeamId = input.getSelectedTeamId ?? getStoredSelectedTeamId;
  const headers = () => {
    const token = input.getAccessToken();
    if (!token) throw new AttachmentApiError(401, 'ログインが必要です。');
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(getSelectedTeamId()
        ? { [selectedTeamHeaderName]: getSelectedTeamId() as string }
        : {}),
      'Content-Type': 'application/json',
    };
  };

  return {
    async createUploadSession(sessionInput) {
      const body = await readJson<UploadSession>(
        await fetcher('/api/v1/uploads', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(sessionInput),
        }),
      );
      if (!body.attachmentId || !body.uploadUrl)
        throw new AttachmentApiError(502, '応答形式が不正です。');
      return body;
    },
    async completeUpload(completeInput) {
      const body = await readJson<{ data?: AvailableAttachment }>(
        await fetcher(
          `/api/v1/uploads/${encodeURIComponent(completeInput.attachmentId)}/complete`,
          {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({
              sha256: completeInput.sha256,
              byteSize: completeInput.byteSize,
            }),
          },
        ),
      );
      if (!body.data) throw new AttachmentApiError(502, '応答形式が不正です。');
      return body.data;
    },
    async createDownloadUrl(attachmentId) {
      const body = await readJson<{
        data?: { downloadUrl?: string };
      }>(
        await fetcher(
          `/api/v1/uploads/${encodeURIComponent(attachmentId)}/download`,
          { headers: headers() },
        ),
      );
      if (!body.data?.downloadUrl)
        throw new AttachmentApiError(502, '応答形式が不正です。');
      return body.data.downloadUrl;
    },
  };
}
