import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LandingPage } from './landing-page.js';

describe('公開トップページ', () => {
  const html = renderToStaticMarkup(createElement(LandingPage));

  it('参照デザインの価値と主要機能を伝える', () => {
    expect(html).toContain('チームの毎日を、');
    expect(html).toContain('もっと心地よく。');
    expect(html).toContain('大切なチームの情報を、');
    for (const feature of [
      '予定・出欠',
      '連絡・回覧',
      '購買・集金',
      '送迎サポート',
    ]) {
      expect(html).toContain(feature);
    }
    expect(html).toContain('よくある質問');
  });

  it('ログインと操作マニュアルへの導線を持つ', () => {
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/manual"');
    expect(html).not.toContain('mailto:');
  });

  it('公開ページに必要なランドマークとスキップリンクを持つ', () => {
    expect(html).toContain('href="#lp-main"');
    expect(html).toContain('id="lp-main" tabindex="-1"');
    expect(html).toContain('<header');
    expect(html).toContain('<main id="lp-main"');
    expect(html).toContain('<footer');
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it('ロゴと操作部品を含むデザインシステムを適用する', () => {
    expect(html).toContain('data-design-system="cocolo"');
    expect(html).toContain('class="logo-mark"');
    expect(html).toContain('<svg');
    expect(html).toContain('type="button"');
  });

  it('LINE連携を主導線として明示する', () => {
    expect(html).toContain('data-line-integration="primary"');
    expect(html).toContain('LINEとつながる、チーム運営');
    expect(html).toContain('href="#line"');
    expect(html).toContain('LINEグループへの通知');
    expect(html).toContain('無料ではじめる');
    expect(html).not.toContain('LINEで無料ではじめる');
  });
});
