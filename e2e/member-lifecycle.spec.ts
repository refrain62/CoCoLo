import { expect, test } from '@playwright/test';

const isEnabled = Boolean(
  process.env.MEMBER_LIFECYCLE_E2E === '1' &&
    process.env.MEMBER_LIFECYCLE_MEMBER_ID &&
    process.env.MEMBER_LIFECYCLE_ACCESS_TOKEN &&
    process.env.APP_ENV !== 'production',
);

test.describe('部員ライフサイクルAPI', () => {
  test.skip(
    !isEnabled,
    '専用fixtureのID・tokenを指定したときだけライフサイクルE2Eを実行します。',
  );

  test('owner/adminは編集・停止・退部を実行でき、退部を再送しても同じ結果になる', async ({
    request,
  }) => {
    const memberId = process.env.MEMBER_LIFECYCLE_MEMBER_ID as string;
    const authorization = `Bearer ${process.env.MEMBER_LIFECYCLE_ACCESS_TOKEN}`;
    const headers = {
      Authorization: authorization,
      'Content-Type': 'application/json',
    };

    const update = await request.patch(`/api/v1/members/${memberId}`, {
      headers,
      data: {
        name: 'E2Eライフサイクル部員',
        kana: null,
        category: 'student',
        gradeLevel: 5,
        ageGroup: null,
        status: 'active',
      },
    });
    expect(update.status()).toBe(200);
    const updateBody = await update.json();
    expect(updateBody.data).not.toHaveProperty('tenantId');
    expect(updateBody.data).not.toHaveProperty('note');

    const suspend = await request.patch(`/api/v1/members/${memberId}`, {
      headers,
      data: {
        name: 'E2Eライフサイクル部員',
        kana: null,
        category: 'student',
        gradeLevel: 5,
        ageGroup: null,
        status: 'suspended',
      },
    });
    expect(suspend.status()).toBe(200);
    expect((await suspend.json()).data.status).toBe('suspended');

    const retire = await request.post(`/api/v1/members/${memberId}/retire`, {
      headers: { Authorization: authorization },
    });
    const retry = await request.post(`/api/v1/members/${memberId}/retire`, {
      headers: { Authorization: authorization },
    });
    expect(retire.status()).toBe(200);
    expect((await retire.json()).data.status).toBe('retired');
    expect(retry.status()).toBe(200);
    expect((await retry.json()).data.status).toBe('retired');
  });
});
