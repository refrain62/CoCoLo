import { expect, test } from '@playwright/test';

test('API health endpoint is reachable', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.ok()).toBeTruthy();
  await expect(response).toBeOK();
});
