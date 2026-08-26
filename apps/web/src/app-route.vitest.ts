import { describe, expect, it } from 'vitest';
import { resolveAppEntry, resolvePageMetadata } from './app-route.js';

describe('Webエントリのルート境界', () => {
  it('トップページだけをLPとして公開する', () => {
    expect(resolveAppEntry('/')).toBe('landing');
  });

  it('マニュアルを認証処理から分離する', () => {
    expect(resolveAppEntry('/manual')).toBe('manual');
  });

  it.each([
    '/login',
    '/admin',
    '/invite/opaque-token',
    '/events/0198f54c-9b5a-7a11-8e2d-8f7dd768f942',
    '/bulletins/0198f54c-9b5a-7a11-8e2d-8f7dd768f942',
  ])('%sをLPに奪わせず認証経路へ渡す', (pathname) => {
    expect(resolveAppEntry(pathname)).toBe('authenticated');
  });
});

describe('ページメタデータ', () => {
  it.each([
    ['/', 'CoCoLo | 部活・クラブの連絡と運営をひとつに'],
    ['/manual', 'CoCoLo 操作マニュアル'],
    ['/login', 'CoCoLoへログイン'],
    ['/admin/events', 'CoCoLo | チーム管理'],
    ['/team/events', 'CoCoLo | チーム管理'],
    ['/dashboard', 'CoCoLo | ダッシュボード'],
  ])('%sの用途に合うtitleを返す', (pathname, title) => {
    expect(resolvePageMetadata(pathname).title).toBe(title);
    expect(resolvePageMetadata(pathname).description).not.toBe('');
  });
});
