export type AppEntry = 'landing' | 'manual' | 'authenticated';

export type PageMetadata = {
  title: string;
  description: string;
};

/** 公開LPと、既存の認証・deep link経路の境界を一か所で判定します。 */
export function resolveAppEntry(pathname: string): AppEntry {
  if (pathname === '/') return 'landing';
  if (pathname === '/manual') return 'manual';
  return 'authenticated';
}

export function resolvePageMetadata(pathname: string): PageMetadata {
  if (pathname === '/')
    return {
      title: 'CoCoLo | 部活・クラブの連絡と運営をひとつに',
      description:
        'CoCoLoは、部活・クラブで散らばりがちな予定や連絡を目的ごとに整理し、チャットに埋もれた情報を探す手間を減らすチーム運営ツールです。',
    };
  if (pathname === '/manual')
    return {
      title: 'CoCoLo 操作マニュアル',
      description: 'CoCoLoの基本操作と安全な利用方法を確認できます。',
    };
  if (pathname === '/login')
    return {
      title: 'CoCoLoへログイン',
      description: 'CoCoLoを利用中の方のログインページです。',
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
