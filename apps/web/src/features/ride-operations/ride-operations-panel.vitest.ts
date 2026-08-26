import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  GuardianConfirmedAssignments,
  SafeMapsLink,
} from './ride-operations-panel.js';

const confirmedAssignments = [
  {
    id: 'assignment-1',
    requestId: 'request-1',
    offerId: 'offer-1',
    memberName: '山田 花子',
    driverName: '山田 太郎',
    passengerCount: 2,
  },
];

describe('送迎のguardian向け確定配車表示', () => {
  it('finalized時だけ名前と人数を表示し、識別子を表示しない', () => {
    const markup = renderToStaticMarkup(
      createElement(GuardianConfirmedAssignments, {
        status: 'finalized',
        assignments: confirmedAssignments,
      }),
    );

    expect(markup).toContain('山田 花子');
    expect(markup).toContain('山田 太郎');
    expect(markup).toContain('2人');
    expect(markup).not.toContain('assignment-1');
  });

  it('確定公開前は配車を表示しない', () => {
    const markup = renderToStaticMarkup(
      createElement(GuardianConfirmedAssignments, {
        status: 'closed',
        assignments: confirmedAssignments,
      }),
    );

    expect(markup).toBe('');
  });

  it('集合場所URLが未設定なら推測せず運営確認を表示する', () => {
    const markup = renderToStaticMarkup(
      createElement(SafeMapsLink, {
        url: null,
        label: '集合場所を地図で開く',
        missingMessage: '集合場所の地図は未設定。運営に確認',
      }),
    );

    expect(markup).toContain('集合場所の地図は未設定。運営に確認');
    expect(markup).not.toContain('<a');
  });
});
