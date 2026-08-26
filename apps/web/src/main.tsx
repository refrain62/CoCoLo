import { AppShell } from '@cocolo/ui';
import { Component, type ReactNode, StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { applyPageMetadata, resolveAppEntry } from './app-route.js';
import { AuthRuntime } from './auth-runtime.js';
import { LandingPage } from './landing-page.js';
import { UserManualPage } from './user-manual-page.js';
import './styles.css';

class AuthenticatedLoadBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  override state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError)
      return (
        <AppShell>
          <section className="app-state-card" role="alert">
            <h1>管理画面を読み込めません</h1>
            <p>通信状態を確認して、もう一度お試しください。</p>
            <button type="button" onClick={() => window.location.reload()}>
              もう一度試す
            </button>
          </section>
        </AppShell>
      );
    return this.props.children;
  }
}

function App() {
  const entry = resolveAppEntry(window.location.pathname);
  useEffect(() => {
    applyPageMetadata(window.location.pathname);
  }, []);
  // 公開トップページでは認証処理や管理機能のコードを読み込まず、公開LPと認証済み画面を分離する。
  if (entry === 'landing')
    return (
      <AuthenticatedLoadBoundary>
        <AuthRuntime publicRoot={<LandingPage />} />
      </AuthenticatedLoadBoundary>
    );

  // マニュアルは認証情報やチームデータを含まないため、ログイン前にも公開する。
  if (entry === 'manual')
    return (
      <AppShell>
        <UserManualPage />
      </AppShell>
    );

  return (
    <AuthenticatedLoadBoundary>
      <AuthRuntime />
    </AuthenticatedLoadBoundary>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('root element is missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
