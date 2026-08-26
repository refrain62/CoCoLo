import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestDatabaseTarget } from './test-database-guard.ts';

type FixtureUser = {
  email: string;
  password: string;
  appMetadata: Record<string, unknown>;
};

const fixtureUsers = {
  ownerA: {
    email: process.env.E2E_TEST_EMAIL ?? 'owner-a@example.test',
    password: process.env.E2E_TEST_PASSWORD ?? 'owner-password',
    appMetadata: {},
  },
  ownerC: {
    email: process.env.LOCAL_TEAM_C_EMAIL ?? 'owner-c@example.test',
    password: process.env.LOCAL_TEAM_C_PASSWORD ?? 'owner-c-password',
    appMetadata: {},
  },
  systemAdmin: {
    email:
      process.env.LOCAL_SYSTEM_ADMIN_EMAIL ?? 'system-admin@example.test',
    password:
      process.env.LOCAL_SYSTEM_ADMIN_PASSWORD ?? 'system-admin-password',
    appMetadata: { system_admin: true },
  },
} satisfies Record<string, FixtureUser>;

for (const user of Object.values(fixtureUsers))
  assert.match(
    user.email,
    /^[^@\s]+@example\.test$/i,
    'local Auth fixtureのメールアドレスはexample.testに限定します。',
  );
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminDatabaseUrl = process.env.SUPABASE_ADMIN_DATABASE_URL;
assert.ok(supabaseUrl, 'SUPABASE_URL が必要です。');
assert.ok(serviceRoleKey, 'Supabase localのService Role Keyが必要です。');
assert.ok(adminDatabaseUrl, 'Supabase localの管理者DB URLが必要です。');
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

type AuthUser = {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
};
type UserList = { users?: AuthUser[] };

async function ensureUser(user: FixtureUser): Promise<string> {
  const list = await adminRequest<UserList>(
    '/auth/v1/admin/users?page=1&per_page=1000',
  );
  const existing = list.users?.find(
    (candidate) => candidate.email?.toLowerCase() === user.email.toLowerCase(),
  );
  const appMetadata = {
    ...(existing?.app_metadata ?? {}),
    ...user.appMetadata,
  };
  const body = JSON.stringify({
    password: user.password,
    email_confirm: true,
    user_metadata: { cocolo_fixture: true },
    app_metadata: appMetadata,
  });
  if (existing) {
    await adminRequest(`/auth/v1/admin/users/${existing.id}`, {
      method: 'PUT',
      body,
    });
    return existing.id;
  }
  const created = await adminRequest<AuthUser>('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: { cocolo_fixture: true },
      app_metadata: appMetadata,
    }),
  });
  assert.match(
    created.id,
    /^[0-9a-f-]{36}$/i,
    'Auth fixture user idがUUIDではありません。',
  );
  return created.id;
}

const ownerAUserId = await ensureUser(fixtureUsers.ownerA);
const ownerCUserId = await ensureUser(fixtureUsers.ownerC);
await ensureUser(fixtureUsers.systemAdmin);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Auth管理APIはservice roleで呼ぶが、DB fixtureはmigration roleでschema ownerとして投入する。
const childEnv = {
  ...process.env,
  TEST_AUTH_USER_ID: ownerAUserId,
  TEST_AUTH_TEAM_C_USER_ID: ownerCUserId,
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
