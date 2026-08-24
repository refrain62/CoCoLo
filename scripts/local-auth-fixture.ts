import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestDatabaseTarget } from './test-database-guard.ts';

const email = process.env.E2E_TEST_EMAIL ?? 'owner-a@example.test';
const password = process.env.E2E_TEST_PASSWORD ?? 'owner-password';
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminDatabaseUrl = process.env.SUPABASE_ADMIN_DATABASE_URL;
const fixtureDatabaseUrl = adminDatabaseUrl
  ? new URL(adminDatabaseUrl)
  : undefined;
if (fixtureDatabaseUrl) {
  fixtureDatabaseUrl.username = 'cocolo_fixture';
  fixtureDatabaseUrl.password =
    process.env.COCOLO_FIXTURE_PASSWORD ?? 'cocolo_fixture';
}
assert.ok(supabaseUrl, 'SUPABASE_URL が必要です。');
assert.ok(serviceRoleKey, 'Supabase localのService Role Keyが必要です。');
assert.ok(adminDatabaseUrl, 'Supabase localの管理者DB URLが必要です。');
assert.ok(fixtureDatabaseUrl, 'Supabase localのfixture DB URLが必要です。');
const parsedSupabaseUrl = new URL(supabaseUrl);
assert.equal(parsedSupabaseUrl.protocol, 'http:');
assert.ok(
  parsedSupabaseUrl.hostname === '127.0.0.1' ||
    parsedSupabaseUrl.hostname === 'localhost',
  'fixture用Supabase URLはloopbackに限定します。',
);
assert.ok(
  parsedSupabaseUrl.port === '54321' || parsedSupabaseUrl.port === '55321',
  'fixture用Supabase portが許可されていません。',
);
assertTestDatabaseTarget();
assertTestDatabaseTarget({
  databaseUrl: adminDatabaseUrl,
  directUrl: adminDatabaseUrl,
});
assertTestDatabaseTarget({
  databaseUrl: fixtureDatabaseUrl.toString(),
  directUrl: fixtureDatabaseUrl.toString(),
});

const headers = {
  Accept: 'application/json',
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  'Content-Type': 'application/json',
};

async function adminRequest<T>(pathName: string, init: RequestInit = {}) {
  const response = await fetch(`${supabaseUrl}${pathName}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  if (!response.ok)
    throw new Error(
      `Supabase local Auth管理APIが失敗しました: ${response.status}`,
    );
  return (await response.json()) as T;
}

type AuthUser = { id: string; email?: string };
type UserList = { users?: AuthUser[] };

async function ensureUser(): Promise<string> {
  const list = await adminRequest<UserList>(
    '/auth/v1/admin/users?page=1&per_page=1000',
  );
  const existing = list.users?.find(
    (user) => user.email?.toLowerCase() === email.toLowerCase(),
  );
  if (existing) {
    await adminRequest(`/auth/v1/admin/users/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        password,
        email_confirm: true,
        user_metadata: { cocolo_fixture: true },
      }),
    });
    return existing.id;
  }
  const created = await adminRequest<AuthUser>('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { cocolo_fixture: true },
    }),
  });
  assert.match(
    created.id,
    /^[0-9a-f-]{36}$/i,
    'Auth fixture user idがUUIDではありません。',
  );
  return created.id;
}

const userId = await ensureUser();
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const childEnv = {
  ...process.env,
  DATABASE_URL: fixtureDatabaseUrl.toString(),
  DIRECT_URL: fixtureDatabaseUrl.toString(),
  TEST_AUTH_USER_ID: userId,
  TEST_DATABASE_RESET_ALLOWED: 'true',
};
const command = process.execPath;
const result = spawnSync(
  command,
  [path.join(root, 'scripts', 'db-seed-test.ts')],
  {
    env: childEnv,
    stdio: 'inherit',
  },
);
if (result.error) throw result.error;
assert.equal(
  result.status,
  0,
  'Auth fixtureに対応するDB fixture投入に失敗しました。',
);
console.log('Supabase local Authの合成ユーザーとDB fixtureを準備しました。');
