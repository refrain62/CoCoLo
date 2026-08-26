import { AppShell, type AppShellProps, Button } from '@cocolo/ui';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

describe('CoCoLo共通デザインシステム', () => {
  it('管理画面の共通シェルと操作部品へ同じテーマを適用する', () => {
    const html = renderToStaticMarkup(
      createElement(
        AppShell,
        {} as AppShellProps,
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
});
