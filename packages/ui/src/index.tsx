import type { ReactNode } from 'react';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      {children}
    </main>
  );
}
