import { AppShell } from '@cocolo/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, LoginPage, useAuth } from './auth-context.js';
import { MemberManagementPage } from './member-management-page.js';
import './styles.css';

function AuthenticatedApp() {
  const { session } = useAuth();
  if (!session) return <LoginPage />;

  return (
    <AppShell>
      <MemberManagementPage />
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
