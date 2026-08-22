import { AppShell } from '@cocolo/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, LoginPage, useAuth } from './auth-context.js';
import { CentralNavigation } from './central-navigation.js';
import { UserManualPage } from './user-manual-page.js';
import './styles.css';

function AuthenticatedApp() {
  // 認証状態が確定するまでLoginPageを表示し、中央ナビゲーションへtokenを渡す。
  const { session } = useAuth();
  if (!session) return <LoginPage />;

  return (
    <AppShell>
      <CentralNavigation session={session} />
    </AppShell>
  );
}

function App() {
  // マニュアルは認証情報やチームデータを含まないため、ログイン前にも公開する。
  if (window.location.pathname === '/manual')
    return (
      <AppShell>
        <UserManualPage />
      </AppShell>
    );

  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('root element is missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
