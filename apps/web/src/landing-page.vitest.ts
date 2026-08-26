import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LandingPage } from './landing-page.js';

describe('公開トップページ', () => {
  const html = renderToStaticMarkup(createElement(LandingPage));

  it('チャットに埋もれる課題とCoCoLoの価値を伝える', () => {
    expect(html).toContain('大切な連絡が、');
    expect(html).toContain('チャットに埋もれない');
    expect(html).toContain('LINEをやめずに、情報の迷子をなくす。');
    expect(html).toContain('LINEへの返信だけでは出欠などは確定しません');
  });

  it('主要機能と提供条件を明示する', () => {
    for (const feature of [
      '予定・出欠',
      '回覧・添付',
      '送迎管理',
      '注文・集金',
      'メンバー・役員',
      'LINE通知',
    ]) {
      expect(html).toContain(feature);
    }
    expect(html).toContain(
      '公開環境での受入検証を進めながら順次提供しています',
    );
    expect(html.match(/順次提供/g)).toHaveLength(7);
  });

  it('ログインと操作マニュアルへの実在する導線を持つ', () => {
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/manual"');
    expect(html).not.toContain('無料で始める');
  });

  it('公開ページに必要なランドマークとスキップリンクを持つ', () => {
    expect(html).toContain('href="#landing-main"');
    expect(html).toContain('id="landing-main" tabindex="-1"');
    expect(html).toContain('<header');
    expect(html).toContain('<main id="landing-main"');
    expect(html).toContain('<footer');
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it('初めての利用者にも使い方とデザインシステムの意図を伝える', () => {
    expect(html).toContain('data-design-system="cocolo"');
    expect(html).toContain('href="#how"');
    expect(html).toContain('気づく');
    expect(html).toContain('見る');
    expect(html).toContain('戻る');
    expect(html).not.toContain('<svg');
  });
});
