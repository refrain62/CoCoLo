import { expect, test } from '@playwright/test';

test('操作マニュアルは未ログインでもサイトから確認できる', async ({ page }) => {
  await page.goto('/manual');

  await expect(
    page.getByRole('heading', { name: 'CoCoLo 操作マニュアル', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '部員を登録する', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '年度繰り上げを実行する', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'ログイン・部員管理へ戻る' }).first(),
  ).toHaveAttribute('href', '/login');
});

test('ログイン画面から操作マニュアルへ移動できる', async ({ page }) => {
  await page.goto('/login');

  await expect(
    page.getByRole('link', { name: '操作マニュアルを確認' }),
  ).toHaveAttribute('href', '/manual');
});
