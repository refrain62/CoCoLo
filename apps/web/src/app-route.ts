export type AppEntry = 'landing' | 'manual' | 'authenticated';

import { isLegacyTeamPath, normalizeRoutePath } from './admin-routes.js';

export type PageMetadata = {
  title: string;
  description: string;
};

/** 公開LPと、既存の認証・deep link経路の境界を一か所で判定します。 */
export function resolveAppEntry(pathname: string): AppEntry {
  const normalizedPath = normalizeRoutePath(pathname);
  if (normalizedPath === '/') return 'landing';
  if (normalizedPath === '/manual') return 'manual';
  return 'authenticated';
}

export function resolvePageMetadata(pathname: string): PageMetadata {
  const normalizedPath = normalizeRoutePath(pathname);
  if (normalizedPath === '/')
    return {
      title: 'CoCoLo | 部活・クラブの連絡と運営をひとつに',
      description:
        'CoCoLoは、部活・クラブで散らばりがちな予定や連絡を目的ごとに整理し、チャットに埋もれた情報を探す手間を減らすチーム運営ツールです。',
    };
  if (normalizedPath === '/manual')
    return {
      title: 'CoCoLo 操作マニュアル',
      description: 'CoCoLoの基本操作と安全な利用方法を確認できます。',
    };
  if (normalizedPath === '/login')
    return {
      title: 'CoCoLo | チームログイン',
      description: 'CoCoLoを利用中のチームメンバー向けログインページです。',
    };
  if (
    normalizedPath === '/admin' ||
    (normalizedPath.startsWith('/admin/') && !isLegacyTeamPath(normalizedPath))
  )
    return {
      title: 'CoCoLo | システム管理',
      description: 'CoCoLo全体のお知らせと有償機能を管理する画面です。',
    };
  if (
    normalizedPath === '/dashboard' ||
    normalizedPath.startsWith('/dashboard/')
  )
    return {
      title: 'CoCoLo | ダッシュボード',
      description: '直近2週間の予定と締め切りを確認できます。',
    };
  if (normalizedPath === '/team' || normalizedPath.startsWith('/team/'))
    return {
      title: 'CoCoLo | チーム管理',
      description: '選択中チームの管理画面です。',
    };
  return {
    title: 'CoCoLo | チーム管理',
    description: 'CoCoLoの認証済みチーム管理画面です。',
  };
}

export function applyPageMetadata(pathname: string) {
  const metadata = resolvePageMetadata(pathname);
  document.title = metadata.title;
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute('content', metadata.description);
}
