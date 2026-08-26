import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthRuntime } from './auth-runtime.js';

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

    expect(html).toContain('CoCoLoへログイン');
    expect(html).toContain('name="email"');
    expect(html).not.toContain('管理画面を準備しています');
  });
});
