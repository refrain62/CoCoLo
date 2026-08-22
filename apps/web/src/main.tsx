import { AppShell } from '@cocolo/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, LoginPage, useAuth } from './auth-context.js';

function AuthenticatedApp() {
  const { session } = useAuth();
  if (!session) return <LoginPage />;

  return (
    <AppShell>
      <main>
        <h1>CoCoLo</h1>
        <p>チーム運営を、心をひとつに。</p>
      </main>
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
