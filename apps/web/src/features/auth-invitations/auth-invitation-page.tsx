import { AppShell } from '@cocolo/ui';
import { useEffect, useState } from 'react';
import type { OAuthProvider } from '../../auth-client.js';
import { useAuth } from '../../auth-context.js';
import {
  type AuthInvitationApi,
  AuthInvitationApiError,
} from './auth-invitation-api.js';

const INVITATION_TOKEN_KEY = 'cocolo.pendingInvitationToken';
const INVITATION_PROVIDER_KEY = 'cocolo.pendingInvitationProvider';

function isInvitationToken(value: string | null) {
  return Boolean(value && value.length >= 32 && value.length <= 256);
}

function getStoredValue(key: string) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStoredValue(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // sessionStorageが使えない場合も、OAuth遷移前のURLだけへ秘密情報を残さない。
  }
}

function removeStoredValue(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // 保存先の利用不可は受諾結果へ影響させない。
  }
}

export function isInvitationPath(pathname: string) {
  return /^\/invite\/[^/]+$/.test(pathname);
}

/** 招待tokenを一度だけsessionStorageへ退避し、アドレスバーから除去する。 */
export function readInvitationToken(
  pathname = window.location.pathname,
  hash = window.location.hash,
) {
  if (!isInvitationPath(pathname)) return null;
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  if (isInvitationToken(token)) {
    setStoredValue(INVITATION_TOKEN_KEY, token as string);
    window.history.replaceState(
      null,
      document.title,
      `${window.location.pathname}${window.location.search}`,
    );
    return token;
  }
  const stored = getStoredValue(INVITATION_TOKEN_KEY);
  return isInvitationToken(stored) ? stored : null;
}

function readProvider(): OAuthProvider | null {
  const value = getStoredValue(INVITATION_PROVIDER_KEY);
  return value === 'google' || value === 'line' ? value : null;
}

function storeProvider(provider: OAuthProvider) {
  setStoredValue(INVITATION_PROVIDER_KEY, provider);
}

function clearInvitationState() {
  removeStoredValue(INVITATION_TOKEN_KEY);
  removeStoredValue(INVITATION_PROVIDER_KEY);
}

export function InvitationAcceptPage({
  api,
  onAccepted,
  token,
}: {
  api: AuthInvitationApi;
  onAccepted: (tenantId: string) => void;
  token: string | null;
}) {
  const { session, signInWithOAuth } = useAuth();
  const [provider, setProvider] = useState<OAuthProvider | null>(readProvider);
  const [isAccepting, setIsAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [acceptedTenantId, setAcceptedTenantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !token || !provider || isAccepting || accepted) return;
    setIsAccepting(true);
    setError(null);
    void api
      .accept({ token, provider })
      .then((result) => {
        if (result.linkStatus !== 'active') {
          setError('部員との連携を有効化できませんでした。');
          return;
        }
        clearInvitationState();
        setAcceptedTenantId(result.tenantId);
        setAccepted(true);
      })
      .catch((requestError: unknown) => {
        setError(
          requestError instanceof AuthInvitationApiError
            ? requestError.message
            : '招待の受諾に失敗しました。',
        );
      })
      .finally(() => setIsAccepting(false));
  }, [accepted, api, isAccepting, provider, session, token]);

  function beginOAuth(nextProvider: OAuthProvider) {
    if (!token) return;
    storeProvider(nextProvider);
    setProvider(nextProvider);
    setError(null);
    signInWithOAuth(nextProvider);
  }

  if (!token)
    return (
      <AppShell className="auth-shell" nav={null}>
        <section className="auth-card" aria-labelledby="invitation-heading">
          <p className="auth-eyebrow">INVITATION</p>
          <h1 id="invitation-heading">招待リンクが無効です</h1>
          <p role="alert">
            有効な招待tokenを確認できません。発行元へ再発行を依頼してください。
          </p>
        </section>
      </AppShell>
    );

  if (accepted)
    return (
      <AppShell className="auth-shell" nav={null}>
        <section className="auth-card" aria-labelledby="invitation-heading">
          <p className="auth-eyebrow">INVITATION ACCEPTED</p>
          <h1 id="invitation-heading">メンバー連携が完了しました</h1>
          <p>チーム画面へ進むと、担当部員の回答や購入を行えます。</p>
          <button
            type="button"
            disabled={!acceptedTenantId}
            onClick={() => {
              if (acceptedTenantId) onAccepted(acceptedTenantId);
            }}
          >
            チーム画面へ進む
          </button>
        </section>
      </AppShell>
    );

  return (
    <AppShell className="auth-shell" nav={null}>
      <section className="auth-card" aria-labelledby="invitation-heading">
        <p className="auth-eyebrow">TEAM INVITATION</p>
        <h1 id="invitation-heading">チームへ招待されています</h1>
        <p>
          メンバーごとの回答・購入を行うには、招待されたOAuthアカウントでログインしてください。
        </p>
        {error ? <p role="alert">{error}</p> : null}
        {!session ? (
          <fieldset className="auth-provider-actions">
            <legend>OAuthでログインして招待を受諾</legend>
            <button type="button" onClick={() => beginOAuth('line')}>
              LINEでログイン
            </button>
            <button type="button" onClick={() => beginOAuth('google')}>
              Googleでログイン
            </button>
          </fieldset>
        ) : (
          <p role="status">
            {isAccepting
              ? 'OAuthアカウントとの連携を確認しています。'
              : 'OAuth providerを選択して再ログインしてください。'}
          </p>
        )}
        {session && !isAccepting ? (
          <fieldset className="auth-provider-actions">
            <legend>連携するOAuth provider</legend>
            <button type="button" onClick={() => beginOAuth('line')}>
              LINEで再ログイン
            </button>
            <button type="button" onClick={() => beginOAuth('google')}>
              Googleで再ログイン
            </button>
          </fieldset>
        ) : null}
      </section>
    </AppShell>
  );
}
