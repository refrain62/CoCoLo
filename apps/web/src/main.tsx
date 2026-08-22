import { AppShell } from '@cocolo/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemberManagementPage } from './member-management-page.js';

function App() {
  return (
    <AppShell>
      <MemberManagementPage />
    </AppShell>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('root element is missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
