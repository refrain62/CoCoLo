import { AppShell } from '@cocolo/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return (
    <AppShell>
      <h1>CoCoLo</h1>
      <p>チーム運営を、心をひとつに。</p>
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
