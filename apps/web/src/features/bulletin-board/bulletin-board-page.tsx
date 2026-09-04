import { type FormEvent, useCallback, useEffect, useState } from 'react';
import type { AttachmentApi } from '../attachments/attachment-api.js';
import {
  type Announcement,
  type AnnouncementCreateInput,
  type AnnouncementSummary,
  type BulletinBoardApi,
  BulletinBoardApiError,
  type BulletinBoardRole,
  createBulletinBoardApi,
} from './bulletin-board-api.js';

const defaultApi = createBulletinBoardApi();
const publisherRoles = new Set<BulletinBoardRole>(['owner', 'admin', 'staff']);

function getErrorMessage(error: unknown) {
  if (error instanceof BulletinBoardApiError) return error.message;
  if (error instanceof Error) return error.message;
  return '通信に失敗しました。';
}

function isResourceUnavailable(error: unknown) {
  return (
    error instanceof BulletinBoardApiError &&
    (error.status === 403 || error.status === 404)
  );
}

function formatBytes(byteSize: number) {
  if (byteSize < 1024) return `${byteSize} B`;
  return `${Math.ceil(byteSize / 1024)} KiB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function AnnouncementList({
  announcements,
  selectedId,
  onSelect,
}: {
  announcements: AnnouncementSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (announcements.length === 0)
    return <p role="status">掲載された回覧はありません。</p>;
  return (
    <ul aria-label="回覧一覧">
      {announcements.map((announcement) => (
        <li key={announcement.id}>
          <button
            type="button"
            aria-current={selectedId === announcement.id ? 'true' : undefined}
            onClick={() => onSelect(announcement.id)}
          >
            {announcement.isRead ? '' : '未読：'}
            {announcement.title}
          </button>{' '}
          <small>{formatDate(announcement.publishedAt)}</small>
          {announcement.attachmentCount > 0 ? (
            <small>（添付{announcement.attachmentCount}件）</small>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function AnnouncementDetail({
  announcement,
  attachmentApi,
  attachmentsEnabled,
  onListUnread,
}: {
  announcement: Announcement;
  attachmentApi: AttachmentApi;
  attachmentsEnabled: boolean;
  onListUnread: () => void;
}) {
  return (
    <article aria-labelledby="bulletin-detail-heading">
      <h3 id="bulletin-detail-heading">{announcement.title}</h3>
      <p>
        掲載日時：{formatDate(announcement.publishedAt)}
        {announcement.readAt
          ? `／確認日時：${formatDate(announcement.readAt)}`
          : '／未読'}
      </p>
      <div>
        <p className="preserve-linebreaks">{announcement.body}</p>
      </div>
      {attachmentsEnabled && announcement.attachments.length > 0 ? (
        <section aria-labelledby="bulletin-attachments-heading">
          <h4 id="bulletin-attachments-heading">添付メタデータ</h4>
          <ul>
            {announcement.attachments.map((attachment) => (
              <li key={attachment.id}>
                {attachment.mediaType}・{formatBytes(attachment.byteSize)}{' '}
                <AttachmentDownloadButton
                  api={attachmentApi}
                  attachmentId={attachment.id}
                  mediaType={attachment.mediaType}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {announcement.canViewUnread ? (
        <button type="button" onClick={onListUnread}>
          未読者を確認
        </button>
      ) : null}
    </article>
  );
}

function AttachmentDownloadButton({
  api,
  attachmentId,
  mediaType,
}: {
  api: AttachmentApi;
  attachmentId: string;
  mediaType: Announcement['attachments'][number]['mediaType'];
}) {
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setError(null);
    setIsPreparing(true);
    try {
      const downloadUrl = await api.createDownloadUrl(attachmentId);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.target = '_blank';
      anchor.rel = 'noreferrer';
      anchor.click();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsPreparing(false);
    }
  }

  return (
    <span>
      <button
        type="button"
        disabled={isPreparing}
        onClick={() => void download()}
        aria-label={`${mediaType}の添付をダウンロード`}
      >
        {isPreparing ? '準備中…' : 'ダウンロード'}
      </button>
      {error ? <span role="alert">（{error}）</span> : null}
    </span>
  );
}

function PublishForm({
  api,
  attachmentsEnabled,
  onPublished,
}: {
  api: BulletinBoardApi;
  attachmentsEnabled: boolean;
  onPublished: (announcement: Announcement) => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [attachmentIds, setAttachmentIds] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const input: AnnouncementCreateInput = {
      title: title.trim(),
      body: body.trim(),
      attachmentIds: attachmentIds
        .split(/[\s,]+/u)
        .map((id) => id.trim())
        .filter(Boolean),
    };
    if (!input.title || !input.body) {
      setError('タイトルと本文を入力してください。');
      return;
    }
    setIsSaving(true);
    try {
      onPublished(await api.publish(input));
      setTitle('');
      setBody('');
      setAttachmentIds('');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section aria-labelledby="bulletin-publish-heading">
      <h2 id="bulletin-publish-heading">回覧を掲載</h2>
      <form noValidate onSubmit={submit}>
        <div>
          <label htmlFor="bulletin-title">タイトル</label>
          <input
            id="bulletin-title"
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="bulletin-body">本文</label>
          <textarea
            id="bulletin-body"
            maxLength={20000}
            rows={8}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </div>
        {attachmentsEnabled ? (
          <div>
            <label htmlFor="bulletin-attachment-ids">
              添付ID（複数は空白またはカンマ区切り）
            </label>
            <input
              id="bulletin-attachment-ids"
              value={attachmentIds}
              onChange={(event) => setAttachmentIds(event.target.value)}
            />
          </div>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={isSaving}>
          {isSaving ? '掲載中…' : '掲載する'}
        </button>
      </form>
    </section>
  );
}

export function BulletinBoardPage({
  api = defaultApi,
  attachmentApi,
  attachmentsEnabled = true,
  role,
  initialAnnouncementId,
  onBack,
  onAccessDenied,
}: {
  api?: BulletinBoardApi;
  attachmentApi: AttachmentApi;
  attachmentsEnabled?: boolean;
  role?: BulletinBoardRole;
  initialAnnouncementId?: string;
  onBack?: () => void;
  onAccessDenied?: () => void;
}) {
  const [announcements, setAnnouncements] = useState<AnnouncementSummary[]>([]);
  const [selected, setSelected] = useState<Announcement | null>(null);
  const [unreadMembers, setUnreadMembers] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [resourceUnavailable, setResourceUnavailable] = useState(false);

  const loadAnnouncements = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setAnnouncements((await api.list()).data);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadAnnouncements();
  }, [loadAnnouncements]);

  const openAnnouncement = useCallback(
    async (id: string) => {
      setError(null);
      setUnreadMembers(null);
      setSelected(null);
      setResourceUnavailable(false);
      try {
        const announcement = await api.get(id);
        if (!announcement.readAt) {
          const read = await api.markRead(id);
          announcement.readAt = read.readAt;
          announcement.isRead = true;
        }
        setResourceUnavailable(false);
        setSelected(announcement);
        setAnnouncements((current) =>
          current.map((item) =>
            item.id === id
              ? { ...item, readAt: announcement.readAt, isRead: true }
              : item,
          ),
        );
      } catch (requestError) {
        setError(getErrorMessage(requestError));
        setResourceUnavailable(isResourceUnavailable(requestError));
      }
    },
    [api],
  );

  useEffect(() => {
    if (initialAnnouncementId) void openAnnouncement(initialAnnouncementId);
  }, [initialAnnouncementId, openAnnouncement]);

  async function listUnread() {
    if (!selected) return;
    setError(null);
    try {
      const result = await api.listUnread(selected.id);
      setUnreadMembers(result.data.map((member) => member.userId));
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  function onPublished(announcement: Announcement) {
    setSelected(announcement);
    setAnnouncements((current) => [
      {
        id: announcement.id,
        title: announcement.title,
        status: announcement.status,
        publishedAt: announcement.publishedAt,
        attachmentCount: announcement.attachments.length,
        readAt: announcement.readAt,
        isRead: announcement.isRead,
        isAuthor: true,
      },
      ...current,
    ]);
  }

  const canPublish = role ? publisherRoles.has(role) : false;
  const isDeepLink = Boolean(initialAnnouncementId);

  return (
    <div>
      {onBack ? (
        <button type="button" onClick={onBack}>
          回覧一覧へ戻る
        </button>
      ) : null}
      {!isDeepLink ? <h1>回覧板</h1> : null}
      {!isDeepLink && canPublish ? (
        <PublishForm
          api={api}
          attachmentsEnabled={attachmentsEnabled}
          onPublished={onPublished}
        />
      ) : null}
      {error && !(isDeepLink && resourceUnavailable) ? (
        <p role="alert">{error}</p>
      ) : null}
      {isDeepLink && resourceUnavailable ? (
        <section role="alert">
          <p>
            この回覧は表示できません。削除済み、期限切れ、または現在のチームで権限がない可能性があります。
          </p>
          {onAccessDenied ? (
            <button type="button" onClick={onAccessDenied}>
              チームを選び直す
            </button>
          ) : null}
        </section>
      ) : null}
      {isLoading ? <p role="status">読み込み中…</p> : null}
      {!isDeepLink ? (
        <section aria-labelledby="bulletin-list-heading">
          <h2 id="bulletin-list-heading">回覧一覧</h2>
          <AnnouncementList
            announcements={announcements}
            selectedId={selected?.id ?? null}
            onSelect={(id) => void openAnnouncement(id)}
          />
        </section>
      ) : null}
      {isDeepLink && !selected && isLoading ? (
        <p role="status">回覧を読み込み中…</p>
      ) : null}
      {selected ? (
        <AnnouncementDetail
          announcement={selected}
          attachmentApi={attachmentApi}
          attachmentsEnabled={attachmentsEnabled}
          onListUnread={() => void listUnread()}
        />
      ) : null}
      {unreadMembers ? (
        <section aria-labelledby="bulletin-unread-heading">
          <h2 id="bulletin-unread-heading">未読者一覧</h2>
          {unreadMembers.length === 0 ? (
            <p>未読者はいません。</p>
          ) : (
            <ul>
              {unreadMembers.map((userId) => (
                <li key={userId}>{userId}</li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
