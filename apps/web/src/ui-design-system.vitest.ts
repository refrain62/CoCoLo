import {
  AppShell,
  type AppShellProps,
  Button,
  ResponsiveTable,
} from '@cocolo/ui';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

describe('CoCoLo共通デザインシステム', () => {
  it('管理画面の共通シェルと操作部品へ同じテーマを適用する', () => {
    const html = renderToStaticMarkup(
      createElement(
        AppShell,
        {
          sidebar: createElement('a', { href: '#menu' }, 'メニュー'),
        } as AppShellProps,
        createElement(Button, { variant: 'secondary' }, '次へ'),
      ),
    );

    expect(html).toContain('data-design-system="cocolo"');
    expect(html).toContain('data-cocolo-ui="tokens-and-primitives"');
    expect(html).toContain('data-slot="button"');
    expect(html).toContain('--cocolo-brand');
    expect(html).toContain('--cocolo-focus-ring');
    expect(html).toContain('class="app-brand-mark"');
    expect(html).toContain(
      'class="app-brand-mark" aria-hidden="true"><span></span><span></span><span></span>',
    );
  });

  it('メニュー未指定時に古い既定ナビゲーションを生成しない', () => {
    const html = renderToStaticMarkup(
      createElement(AppShell, {} as AppShellProps, '本文'),
    );

    expect(html).not.toContain('予定と出欠');
    expect(html).not.toContain('class="app-sidebar"');
  });

  it('レスポンシブ表へモバイル行カード用の識別子を付与する', () => {
    const html = renderToStaticMarkup(
      createElement(
        ResponsiveTable,
        null,
        createElement(
          'tbody',
          null,
          createElement(
            'tr',
            null,
            createElement('td', { 'data-label': '氏名' }, '山田 太郎'),
          ),
        ),
      ),
    );

    expect(html).toContain('data-slot="responsive-table-wrapper"');
    expect(html).toContain('data-slot="responsive-table"');
    expect(html).toContain('data-label="氏名"');
  });
});
