import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SystemAdminPage } from './system-admin-page.js';

const api = {
  listAnnouncements: async () => [],
  createAnnouncement: async () => {
    throw new Error('not called in SSR');
  },
  updateAnnouncement: async () => {
    throw new Error('not called in SSR');
  },
  listFeatures: async () => [],
  updateFeature: async () => {
    throw new Error('not called in SSR');
  },
};

describe('システム管理画面', () => {
  it('system admin向けのお知らせと機能管理の導線を表示する', () => {
    const html = renderToStaticMarkup(
      createElement(SystemAdminPage, {
        api,
        onNavigate: () => undefined,
        route: 'dashboard',
      }),
    );

    expect(html).toContain('システム管理');
    expect(html).toContain('全体お知らせ');
    expect(html).toContain('有償機能');
  });

  it('実データ管理画面には公開状態と全体停止の説明を表示する', () => {
    const notices = renderToStaticMarkup(
      createElement(SystemAdminPage, {
        api,
        onNavigate: () => undefined,
        route: 'notices',
      }),
    );
    const features = renderToStaticMarkup(
      createElement(SystemAdminPage, {
        api,
        onNavigate: () => undefined,
        route: 'entitlements',
      }),
    );

    expect(notices).toContain('お知らせを作成');
    expect(notices).toContain('公開中');
    expect(features).toContain('システム全体の機能');
    expect(features).toContain('全チームで利用不可');
  });
});
