import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthProvider, LoginPage } from './auth-context.js';
import { AuthRuntime, resolveLoginMode } from './auth-runtime.js';

describe('認証ランタイムの公開境界', () => {
  it('未認証の公開ルートは管理画面のloadingではなくLPを表示する', () => {
    const html = renderToStaticMarkup(
      createElement(AuthRuntime, {
        publicRoot: createElement('main', { id: 'public-root' }, '公開LP'),
      }),
    );

    expect(html).toContain('id="public-root"');
    expect(html).toContain('公開LP');
    expect(html).not.toContain('管理画面を準備しています');
  });

  it('未認証の管理入口はログイン画面を表示する', () => {
    const html = renderToStaticMarkup(createElement(AuthRuntime));

    expect(html).toContain('チームログイン');
    expect(html).toContain('class="auth-card-brand"');
    expect(html).toContain('class="app-brand-mark"');
    expect(html).toContain('>CoCoLo</span>');
    expect(html).not.toContain('class="auth-card-icon"');
    expect(html).toContain('name="email"');
    expect(html).not.toContain('管理画面を準備しています');
  });

  it('URLに応じてログイン入口の対象を分ける', () => {
    expect(resolveLoginMode('/login')).toBe('team');
    expect(resolveLoginMode('/team')).toBe('team');
    expect(resolveLoginMode('/admin')).toBe('system');
    expect(resolveLoginMode('/admin/notices')).toBe('system');
    expect(resolveLoginMode('/admin/members')).toBe('team');
  });

  it('システム管理者URLでは専用のログイン画面を表示する', () => {
    const html = renderToStaticMarkup(
      createElement(
        AuthProvider,
        {
          client: {
            signInWithPassword: async () => ({
              accessToken: 'test-access-token',
              refreshToken: null,
              expiresAt: null,
            }),
            refreshSession: async () => ({
              accessToken: 'test-access-token',
              refreshToken: null,
              expiresAt: null,
            }),
            signOut: async () => undefined,
          },
        },
        createElement(LoginPage, { mode: 'system' }),
      ),
    );

    expect(html).toContain('システム管理者ログイン');
    expect(html).toContain('SYSTEM ADMIN');
    expect(html).toContain('この入口はシステム管理者専用です。');
    expect(html).toContain('href="/login"');
  });
});
