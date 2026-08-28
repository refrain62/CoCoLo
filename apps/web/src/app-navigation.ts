import type { MouseEvent } from 'react';

const MODIFIER_KEYS = ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const;

/** 認証済み画面の切り替えでセッションを失わないよう、リロードなしで親ルーターへ通知します。 */
export function navigateInApp(path: string) {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === path) return;
  window.history.pushState({}, '', path);
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
