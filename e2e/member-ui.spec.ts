import { expect, test } from '@playwright/test';

const member = {
  id: '00000000-0000-7000-8000-000000000201',
  name: '山田太郎',
  kana: 'やまだたろう',
  category: 'student',
  gradeLevel: 4,
  ageGroup: null,
  status: 'active',
  phoneNumber: '090-0000-0000',
  note: '画面に表示してはいけない情報',
};

async function setAccessToken(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('cocolo.accessToken', 'test-access-token');
  });
}

test('部員一覧は検索条件を送り、公開項目だけを表示する', async ({ page }) => {
  const requests = [];
  await page.route('**/api/v1/members*', async (route) => {
    const request = route.request();
    requests.push({
      authorization: request.headers().authorization,
      url: new URL(request.url()),
    });
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: [member], page: 1, pageSize: 50 }),
    });
  });
  await setAccessToken(page);

  await page.goto('/members');

  await expect(
    page.getByRole('heading', { name: '部員一覧' }),
  ).toBeVisible();
  await expect(page.getByText('山田太郎')).toBeVisible();
  await expect(page.getByText('小4')).toBeVisible();
  await expect(page.getByText('090-0000-0000')).toHaveCount(0);
  await expect(page.getByText('画面に表示してはいけない情報')).toHaveCount(0);

  await page.getByLabel('検索').fill('山田');
  await page.getByRole('button', { name: '検索' }).click();

  await expect
    .poll(() => requests.at(-1)?.url.searchParams.get('q'))
    .toBe('山田');
  expect(requests.at(-1)?.authorization).toBe('Bearer test-access-token');
});

test('部員登録はstudentの必須項目を検証し、tenant情報を送らない', async ({
  page,
}) => {
  let postBody;
  await page.route('**/api/v1/members', async (route) => {
    if (route.request().method() === 'POST') {
      postBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ data: member }),
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: [], page: 1, pageSize: 50 }),
    });
  });
  await setAccessToken(page);

  await page.goto('/members');
  await page.getByRole('button', { name: '部員を登録' }).click();
  await page.getByLabel('氏名').fill('佐藤花子');
  await page.getByLabel('区分').selectOption('student');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page.getByText('学年を入力してください')).toBeVisible();
  expect(postBody).toBeUndefined();

  await page.getByLabel('学年').fill('2');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page.getByText('登録しました')).toBeVisible();
  expect(postBody).toMatchObject({
    name: '佐藤花子',
    category: 'student',
    gradeLevel: 2,
    status: 'active',
  });
  expect(postBody).not.toHaveProperty('tenantId');
  expect(postBody).not.toHaveProperty('note');
});

test('登録権限がないAPI応答を権限エラーとして表示する', async ({ page }) => {
  await page.route('**/api/v1/members*', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'FORBIDDEN', message: '登録権限がありません。' },
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: [], page: 1, pageSize: 50 }),
    });
  });
  await setAccessToken(page);

  await page.goto('/members');
  await page.getByRole('button', { name: '部員を登録' }).click();
  await page.getByLabel('氏名').fill('権限外登録');
  await page.getByLabel('区分').selectOption('adult');
  await page.getByLabel('年代').fill('30代');
  await page.getByRole('button', { name: '登録する' }).click();

  await expect(page.getByText('登録権限がありません。')).toBeVisible();
});
