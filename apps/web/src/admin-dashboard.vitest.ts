import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminDashboard } from './admin-dashboard.js';

const team = {
  tenantId: '0190f3b5-7c00-7000-8000-000000000001',
  tenantName: 'テストチーム',
  role: 'owner' as const,
};

function renderDashboard(membersEnabled: boolean) {
  return renderToStaticMarkup(
    createElement(AdminDashboard, {
      contract: {
        planKey: null,
        planStatus: null,
        features: [
          {
            key: 'members',
            billingType: 'free',
            displayName: 'メンバー管理',
            enabled: membersEnabled,
            reason: membersEnabled ? 'default' : 'unavailable',
          },
        ],
      },
      onNavigate: () => undefined,
      role: 'owner',
      team,
    }),
  );
}

describe('管理ダッシュボードのfeature導線', () => {
  it('membersが無効ならメンバー導線を表示しない', () => {
    expect(renderDashboard(false)).not.toContain('メンバーを確認');
  });

  it('membersが有効ならメンバー導線を表示する', () => {
    expect(renderDashboard(true)).toContain('メンバーを確認');
  });
});
