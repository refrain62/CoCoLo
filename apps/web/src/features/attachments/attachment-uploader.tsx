import type { AttachmentMediaType } from '@cocolo/domain/attachment';
import { type ChangeEvent, type FormEvent, useState } from 'react';
import type { AttachmentApi } from './attachment-api.js';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const acceptedMediaTypes = new Set<AttachmentMediaType>([
  'image/jpeg',
  'image/png',
  'application/pdf',
]);

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : '添付に失敗しました。';
}

async function calculateSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await file.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// 署名URLへの直接PUTとAPIのcompleteを分け、ブラウザがR2秘密情報を受け取らない手順を固定する。
export function AttachmentUploader({ api }: { api: AttachmentApi }) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setError(null);
    setSuccess(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (!file) {
      setError('添付ファイルを選択してください。');
      return;
    }
    if (!acceptedMediaTypes.has(file.type as AttachmentMediaType)) {
      setError('JPEG、PNG、PDFだけを添付できます。');
      return;
    }
    if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
      setError('添付ファイルは20 MiB以下にしてください。');
      return;
    }

    setIsUploading(true);
    try {
      const mediaType = file.type as AttachmentMediaType;
      const session = await api.createUploadSession({
        mediaType,
        byteSize: file.size,
      });
      const uploadResponse = await fetch(session.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mediaType },
        body: file,
      });
      if (!uploadResponse.ok)
        throw new Error('ストレージへの送信に失敗しました。');
      const sha256 = await calculateSha256(file);
      const available = await api.completeUpload({
        attachmentId: session.attachmentId,
        sha256,
        byteSize: file.size,
      });
      setSuccess(`添付を保存しました（${available.attachmentId}）。`);
    } catch (uploadError) {
      setError(formatError(uploadError));
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <section aria-labelledby="attachment-upload-heading">
      <h2 id="attachment-upload-heading">添付を追加</h2>
      <p>JPEG、PNG、PDFを20 MiBまで追加できます。</p>
      <form onSubmit={submit}>
        <label htmlFor="attachment-file">ファイル</label>
        <input
          id="attachment-file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={selectFile}
          type="file"
        />
        {error ? <p role="alert">{error}</p> : null}
        {success ? <p role="status">{success}</p> : null}
        <button disabled={isUploading} type="submit">
          {isUploading ? 'アップロード中…' : '添付する'}
        </button>
      </form>
    </section>
  );
}
