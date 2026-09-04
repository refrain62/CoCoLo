import type { MouseEvent } from 'react';

const MODIFIER_KEYS = ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const;

/** 認証済み画面の切り替えでセッションを失わないよう、リロードなしで親ルーターへ通知します。 */
export function navigateInApp(path: string) {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === path) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** 正規化や認証後の既存履歴を置き換え、親ルーターにも現在のパスを通知します。 */
export function replaceInApp(path: string) {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === path) return;
  window.history.replaceState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function handleInAppLinkClick(
  event: MouseEvent<HTMLAnchorElement>,
  path: string,
) {
  if (MODIFIER_KEYS.some((key) => event[key])) return;
  event.preventDefault();
  navigateInApp(path);
}
