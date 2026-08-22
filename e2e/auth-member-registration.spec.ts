import { expect, test } from '@playwright/test';

const isLocal = process.env.E2E_ENV === 'local';
const email =
  process.env.E2E_TEST_EMAIL ?? (isLocal ? 'owner-a@example.test' : '');
const password =
  process.env.E2E_TEST_PASSWORD ?? (isLocal ? 'owner-password' : '');

test('管理者はログイン後に部員を登録でき、APIへBearer tokenを送る', async ({
  page,
}) => {
  if (!email || !password)
    throw new Error(
      'staging 環境の E2E テストには E2E_TEST_EMAIL と E2E_TEST_PASSWORD が必要です。',
    );

  const memberRequests: string[] = [];
  page.on('request', (request) => {
    if (
      request.url().includes('/api/v1/members') &&
      request.method() === 'POST'
    ) {
      memberRequests.push(request.headers().authorization ?? '');
    }
  });

  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();

  await expect(
    page.getByRole('heading', { name: '部員一覧', exact: true }),
  ).toBeVisible();

  const registration = page.getByRole('region', { name: '部員登録操作' });
  await registration.getByRole('button', { name: '部員を登録' }).click();
  await registration.getByLabel('氏名').fill('E2E登録部員');
  await registration.getByLabel('区分').selectOption('student');
  await registration.getByLabel('学年').fill('2');
  await registration.getByRole('button', { name: '登録する' }).click();

  await expect(page.getByText('登録しました')).toBeVisible();
  expect(memberRequests).toHaveLength(1);
  expect(memberRequests[0]).toMatch(/^Bearer\s+\S+$/);
});
