import type { MouseEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleInAppLinkClick,
  navigateInApp,
  replaceInApp,
} from './app-navigation.js';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalPopStateEvent = Object.getOwnPropertyDescriptor(
  globalThis,
  'PopStateEvent',
);

function mockWindow(pathname = '/dashboard') {
  const pushState = vi.fn();
  const dispatchEvent = vi.fn();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      history: { pushState },
      location: { pathname },
      dispatchEvent,
    },
  });
  Object.defineProperty(globalThis, 'PopStateEvent', {
    configurable: true,
    value: class TestPopStateEvent {
      constructor(readonly type: string) {}
    },
  });
  return { dispatchEvent, pushState };
}

afterEach(() => {
  if (originalWindow)
    Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (originalPopStateEvent)
    Object.defineProperty(globalThis, 'PopStateEvent', originalPopStateEvent);
  else Reflect.deleteProperty(globalThis, 'PopStateEvent');
});

describe('認証済み画面のSPA遷移', () => {
  it('リロードせずに履歴と親ルーターへ通知する', () => {
    const { dispatchEvent, pushState } = mockWindow();

    navigateInApp('/team');

    expect(pushState).toHaveBeenCalledWith({}, '', '/team');
    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({
      type: 'popstate',
    });
  });

  it('正規化したパスを履歴置換し、親ルーターへ通知する', () => {
    const { dispatchEvent, pushState } = mockWindow();
    const replaceState = vi.fn();
    window.history.replaceState = replaceState;

    replaceInApp('/team/members');

    expect(replaceState).toHaveBeenCalledWith({}, '', '/team/members');
    expect(pushState).not.toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalledOnce();
  });

  it('修飾キー付きクリックはブラウザのリンク動作を維持する', () => {
    const { pushState } = mockWindow();
    const preventDefault = vi.fn();

    handleInAppLinkClick(
      {
        altKey: false,
        ctrlKey: true,
        metaKey: false,
        preventDefault,
        shiftKey: false,
      } as unknown as MouseEvent<HTMLAnchorElement>,
      '/team',
    );

    expect(preventDefault).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });
});
