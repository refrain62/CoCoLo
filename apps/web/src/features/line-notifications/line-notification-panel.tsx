import { type FormEvent, useEffect, useState } from 'react';
import {
  createLineNotificationApi,
  LineApiError,
  type LineConnectionStatus,
  type LineNotificationApi,
} from './line-notifications-api.js';

type LineRole = 'owner' | 'admin' | 'staff' | 'guardian';

const defaultApi = createLineNotificationApi();
const statusLabels: Record<LineConnectionStatus, string> = {
  connected: '接続済み',
  disconnected: '未接続',
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '通信に失敗しました。';
}

// 接続状態を明示し、未接続を障害扱いせず、LINE通知の操作だけを利用者へ提供する。
export function LineNotificationPanel({
  api = defaultApi,
  role,
}: {
  api?: LineNotificationApi;
  role: LineRole;
}) {
  const [status, setStatus] = useState<LineConnectionStatus | null>(null);
  const [groupId, setGroupId] = useState('');
  const [inputGroupId, setInputGroupId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [deepLink, setDeepLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const canManage = role === 'owner' || role === 'admin';
  const canNotify = canManage;

  useEffect(() => {
    let active = true;
    setIsLoadingStatus(true);
    void api
      .status()
      .then((value) => {
        if (!active) return;
        setStatus(value.status);
        setGroupId(value.groupId ?? '');
      })
      .catch((requestError) => {
        if (!active) return;
        if (
          requestError instanceof LineApiError &&
          requestError.status === 404
        ) {
          setStatus('disconnected');
          setGroupId('');
          return;
        }
        setError(errorMessage(requestError));
      })
      .finally(() => {
        if (active) setIsLoadingStatus(false);
      });
    return () => {
      active = false;
    };
  }, [api]);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    setError(null);
    setMessage(null);
    setIsSaving(true);
    try {
      const value = await api.connect(inputGroupId);
      setStatus(value.status);
      setGroupId(value.groupId ?? '');
      setMessage('LINEグループを接続しました。');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  async function disconnect() {
    if (isSaving) return;
    if (!window.confirm('LINEグループとの接続を解除しますか？')) return;
    setError(null);
    setMessage(null);
    setIsSaving(true);
    try {
      await api.disconnect();
      setStatus('disconnected');
      setGroupId('');
      setMessage('LINEグループの接続を解除しました。');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  async function enqueue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (isSaving) return;
    if (!groupId) {
      setMessage('LINEは未接続のため、通知を登録しませんでした。');
      return;
    }
    setIsSaving(true);
    try {
      await api.enqueue({
        sourceId: sourceId.trim(),
        destination: groupId,
        title: title.trim(),
        body: body.trim(),
        deepLink: deepLink.trim(),
      });
      setMessage('LINE通知をキューへ登録しました。');
      setSourceId('');
      setTitle('');
      setBody('');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section aria-labelledby="line-notification-heading">
      <h2 id="line-notification-heading">LINE通知</h2>
      <p role="status">
        接続状態:{' '}
        {status
          ? statusLabels[status]
          : isLoadingStatus
            ? '確認中…'
            : '確認できません'}
      </p>
      {canManage ? (
        <form onSubmit={connect}>
          <label htmlFor="line-group-id">LINEグループID</label>
          <input
            id="line-group-id"
            maxLength={128}
            required
            value={inputGroupId}
            onChange={(event) => setInputGroupId(event.target.value)}
          />
          <button type="submit" disabled={isSaving || !inputGroupId.trim()}>
            {isSaving ? '接続中…' : '接続する'}
          </button>
          {groupId ? (
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void disconnect()}
            >
              {isSaving ? '処理中…' : '接続を解除'}
            </button>
          ) : null}
        </form>
      ) : null}
      {canNotify ? (
        <form onSubmit={enqueue}>
          <h3>通知を登録</h3>
          <label htmlFor="line-source-id">通知元ID</label>
          <input
            id="line-source-id"
            maxLength={128}
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
          />
          <label htmlFor="line-title">タイトル</label>
          <input
            id="line-title"
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <label htmlFor="line-body">本文</label>
          <textarea
            id="line-body"
            maxLength={4000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <label htmlFor="line-deep-link">アプリ内リンク</label>
          <input
            id="line-deep-link"
            type="url"
            value={deepLink}
            onChange={(event) => setDeepLink(event.target.value)}
          />
          <button type="submit" disabled={isSaving || !groupId}>
            {isSaving ? '登録中…' : '通知を登録する'}
          </button>
        </form>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
