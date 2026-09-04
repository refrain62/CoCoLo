import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../../auth-context.js';
import { TeamSelectionPage } from './team-selection-page.js';

describe('チーム選択画面', () => {
  it('チーム未選択時にもログアウト導線を表示する', () => {
    const markup = renderToStaticMarkup(
      createElement(
        AuthProvider,
        null,
        createElement(TeamSelectionPage, {
          api: {
            list: async () => [],
            select: async () => {
              throw new Error('テストでは選択しない');
            },
          },
          onSelected: () => undefined,
        }),
      ),
    );

    expect(markup).toContain('<button type="button">ログアウト</button>');
  });
});
