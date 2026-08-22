import { AppShell } from '@cocolo/ui';
import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, LoginPage, useAuth } from './auth-context.js';
import { createMemberApi } from './member-api.js';
import { MemberManagementPage } from './member-management-page.js';
import './styles.css';

function AuthenticatedApp() {
  const { session } = useAuth();
  const memberApi = useMemo(
    () =>
      createMemberApi({
        getAccessToken: () => session?.accessToken ?? null,
      }),
    [session?.accessToken],
  );
  if (!session) return <LoginPage />;

  return (
    <AppShell>
      <MemberManagementPage api={memberApi} />
    </AppShell>
  );
}

function App() {
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
