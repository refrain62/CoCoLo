import { expect, test } from '@playwright/test';
import { signInWithMockedAuth } from './mock-auth.js';

test('ダッシュボードとチーム管理は同じ左メニューを使う', async ({ page }) => {
  let teamListRequests = 0;
  let authContextRequests = 0;
  let featureContractRequests = 0;
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/v1/auth/teams')) teamListRequests += 1;
    if (url.includes('/api/v1/auth/context')) authContextRequests += 1;
    if (url.includes('/api/v1/feature-contract')) featureContractRequests += 1;
  });

  await page.route('**/api/v1/members*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: [], page: 1, pageSize: 50 }),
    });
  });

  await signInWithMockedAuth(page);

  const shell = page.locator('main.admin-shell');
  const navigation = shell.getByRole('navigation', { name: 'メインメニュー' });
  const dashboardLink = navigation.locator('a[href="/team"]');
  const membersLink = navigation.locator('a[href="/team/members"]');

  await expect(page).toHaveURL(/\/team$/);
  await expect(shell).toHaveCount(1);
  await expect(dashboardLink).toHaveCount(1);
  await expect(dashboardLink).toHaveAttribute('aria-current', 'page');
  await expect(membersLink).toBeVisible();
  await expect(page.locator('main.user-shell')).toHaveCount(0);
  await expect(
    page.getByRole('heading', {
      name: '次の活動に集中できる状態をつくる',
      exact: true,
    }),
  ).toBeVisible();
  const teamListRequestsAfterSignIn = teamListRequests;
  const authContextRequestsAfterSignIn = authContextRequests;
  expect(featureContractRequests).toBe(1);
  expect(authContextRequestsAfterSignIn).toBe(0);

  await membersLink.click();
  await expect(
    page.getByRole('heading', { name: '部員一覧', exact: true }),
  ).toBeVisible();
  await expect(shell).toHaveCount(1);
  await expect(dashboardLink).toBeVisible();
  await expect(dashboardLink).not.toHaveAttribute('aria-current', 'page');
  await expect(membersLink).toHaveAttribute('aria-current', 'page');
  expect(teamListRequests).toBe(teamListRequestsAfterSignIn);
  expect(authContextRequests).toBe(authContextRequestsAfterSignIn);

  await dashboardLink.click();
  await expect(
    page.getByRole('heading', { name: 'これからの予定', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: '次の活動に集中できる状態をつくる',
      exact: true,
    }),
  ).toBeVisible();
  await expect(dashboardLink).toHaveAttribute('aria-current', 'page');
  await expect(membersLink).not.toHaveAttribute('aria-current', 'page');
  expect(teamListRequests).toBe(teamListRequestsAfterSignIn);
  expect(authContextRequests).toBe(authContextRequestsAfterSignIn);

  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'チームログイン', exact: true }),
  ).toBeVisible();
  await signInWithMockedAuth(page);
  expect(featureContractRequests).toBe(2);
  await expect(
    page.getByRole('heading', {
      name: '次の活動に集中できる状態をつくる',
      exact: true,
    }),
  ).toBeVisible();
});
