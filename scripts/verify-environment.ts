import assert from 'node:assert/strict';

type AppEnvironment = 'local' | 'staging' | 'production';

// 環境名・接続先・公開URL・bucket・production保持期間をallowlistと照合し、環境混同を起動前に拒否する。
const allowed: Record<
  AppEnvironment,
  { R2_BUCKET: string; PUBLIC_APP_URL?: string }
> = {
  local: {
    R2_BUCKET: 'cocolo-local',
    PUBLIC_APP_URL: 'http://localhost:5173',
  },
  staging: {
    R2_BUCKET: 'cocolo-staging-private',
  },
  production: {
    R2_BUCKET: 'cocolo-production-private',
  },
};
const appEnv = process.env.APP_ENV;
if (appEnv !== 'local' && appEnv !== 'staging' && appEnv !== 'production')
  throw new Error(
    'APP_ENV には local / staging / production のいずれかを指定してください。',
  );
const expectedIndex = process.argv.indexOf('--expected');
if (expectedIndex !== -1)
  assert.equal(
    appEnv,
    process.argv[expectedIndex + 1],
    'APP_ENV が期待値と一致しません。',
  );
assert.ok(process.env.DATABASE_URL, 'DATABASE_URL が必要です');
assert.ok(process.env.DIRECT_URL, 'DIRECT_URL が必要です');
assert.ok(process.env.SUPABASE_URL, 'SUPABASE_URL が必要です');
assert.ok(process.env.SUPABASE_JWKS_URL, 'SUPABASE_JWKS_URL が必要です');
assert.ok(process.env.SUPABASE_ANON_KEY, 'SUPABASE_ANON_KEY が必要です');
assert.ok(process.env.R2_BUCKET, 'R2_BUCKET が必要です');
assert.ok(process.env.PUBLIC_APP_URL, 'PUBLIC_APP_URL が必要です');
if (allowed[appEnv].R2_BUCKET)
  assert.equal(process.env.R2_BUCKET, allowed[appEnv].R2_BUCKET);
if (allowed[appEnv].PUBLIC_APP_URL)
  assert.equal(process.env.PUBLIC_APP_URL, allowed[appEnv].PUBLIC_APP_URL);
if (appEnv !== 'local') {
  assert.ok(
    process.env.SUPABASE_ALLOWED_URL,
    `${appEnv} 環境では SUPABASE_ALLOWED_URL が必要です。`,
  );
  assert.ok(
    process.env.SUPABASE_ALLOWED_JWKS_URL,
    `${appEnv} 環境では SUPABASE_ALLOWED_JWKS_URL が必要です。`,
  );
  assert.ok(
    process.env.PUBLIC_APP_URL_ALLOWLIST,
    `${appEnv} 環境では PUBLIC_APP_URL_ALLOWLIST が必要です。`,
  );
}
if (process.env.SUPABASE_ALLOWED_URL)
  assert.equal(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ALLOWED_URL,
    'SUPABASE_URL が許可された環境値と一致しません。',
  );
if (process.env.SUPABASE_ALLOWED_JWKS_URL)
  assert.equal(
    process.env.SUPABASE_JWKS_URL,
    process.env.SUPABASE_ALLOWED_JWKS_URL,
    'SUPABASE_JWKS_URL が許可された環境値と一致しません。',
  );
if (process.env.PUBLIC_APP_URL_ALLOWLIST)
  assert.ok(
    process.env.PUBLIC_APP_URL_ALLOWLIST.split(',')
      .map((value) => value.trim())
      .includes(process.env.PUBLIC_APP_URL),
    'PUBLIC_APP_URL が許可リストに含まれていません。',
  );
if (appEnv === 'production') {
  assert.ok(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    'production 環境では Service Role Key が必要です。',
  );
  assert.ok(
    process.env.RETIRED_DATA_RETENTION_DAYS,
    'production 環境の退部データ保持期間が必要です。',
  );
  assert.ok(
    process.env.AUDIT_LOG_RETENTION_DAYS,
    'production 環境の監査ログ保持期間が必要です。',
  );
}
console.log(`${appEnv} 環境設定を検証しました。`);
