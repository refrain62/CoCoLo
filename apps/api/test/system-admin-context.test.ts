import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../dist/app.js';

function createTestApp() {
  return createApp({
    verifyToken: async (token) => ({
      userId: token,
      issuer: 'https://example.supabase.co/auth/v1',
      audience: 'authenticated',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      systemAdmin: token === 'system-admin',
    }),
  });
}

test('system admin contextはtenant membershipなしで取得できる', async () => {
  const response = await createTestApp().request('/api/v1/system/context', {
    headers: { authorization: 'Bearer system-admin' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { systemAdmin: true } });
});

test('tenant利用者はsystem admin contextへ到達できない', async () => {
  const response = await createTestApp().request('/api/v1/system/context', {
    headers: { authorization: 'Bearer tenant-user' },
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'FORBIDDEN');
});
