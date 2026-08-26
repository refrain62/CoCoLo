import type { TeamOption } from '@cocolo/contracts/auth-team-selection';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TeamSettingsPage } from './team-settings-page.js';

const team: TeamOption = {
  tenantId: '0190f3b5-7c00-7000-8000-000000000001',
  tenantName: 'CoCoLoクラブ',
  role: 'owner',
};

describe('チーム設定画面', () => {
  it('役員連絡先とは別の設定概要と専用画面への導線を表示する', () => {
    const html = renderToStaticMarkup(
      createElement(TeamSettingsPage, {
        onNavigate: () => undefined,
        role: 'owner',
        team,
      }),
    );

    expect(html).toContain('チーム設定');
    expect(html).toContain('機能契約');
    expect(html).toContain('役員・連絡先');
    expect(html).not.toContain('年度役員と連絡先');
  });
});
