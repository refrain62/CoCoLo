import { expect, type Page } from '@playwright/test';

const team = {
  tenantId: '00000000-0000-7000-8000-000000000001',
  tenantName: 'テストチームA',
  role: 'owner',
};

const featureContract = {
  planKey: 'free',
  planStatus: 'active',
  features: [
    {
      key: 'members',
      billingType: 'free',
      displayName: 'メンバー管理',
      enabled: true,
      reason: 'default',
    },
    {
      key: 'events-attendance',
      billingType: 'free',
      displayName: '予定・出欠',
      enabled: true,
      reason: 'default',
    },
    {
      key: 'bulletin-board',
      billingType: 'free',
      displayName: '回覧・添付',
      enabled: true,
      reason: 'default',
    },
    {
      key: 'board-contacts',
      billingType: 'free',
      displayName: '役員・連絡先',
      enabled: true,
      reason: 'default',
    },
    {
      key: 'orders-payments',
      billingType: 'paid',
      displayName: '購買・集金',
      enabled: false,
      reason: 'unavailable',
    },
    {
      key: 'line-notifications',
      billingType: 'paid',
      displayName: 'LINE通知',
      enabled: false,
      reason: 'unavailable',
    },
    {
      key: 'ride-operations',
      billingType: 'paid',
      displayName: '送迎管理',
      enabled: false,
      reason: 'unavailable',
    },
  ],
};

export async function navigateToTeamMembers(page: Page) {
  await page.evaluate(() => {
    window.history.pushState({}, '', '/team');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator('a[href="/team/members"]')).toBeVisible();
  await page.evaluate(() => {
    window.history.pushState({}, '', '/team/members');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

// UI E2Eは認証画面を実際に通し、チーム・権限・feature契約だけをテスト境界で固定する。
export async function signInWithMockedAuth(page: Page) {
  await page.route('**/auth/v1/token*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'test-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
      }),
    });
  });
  await page.route('**/api/v1/auth/teams*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: [team] }),
    });
  });
  await page.route('**/api/v1/auth/context*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: { tenantId: team.tenantId, role: team.role },
      }),
    });
  });
  await page.route('**/api/v1/feature-contract*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: featureContract }),
    });
  });
  await page.route('**/api/v1/events*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.route('**/api/v1/global-announcements*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill('owner-a@example.test');
  await page.getByLabel('パスワード').fill('owner-password');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'これからの予定', exact: true }),
  ).toBeVisible();
}
