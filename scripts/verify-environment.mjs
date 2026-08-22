import assert from 'node:assert/strict';

const allowed = {
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
assert.ok(
  appEnv && appEnv in allowed,
  'APP_ENV は local / staging / production のいずれかが必要です',
);
const expectedIndex = process.argv.indexOf('--expected');
if (expectedIndex !== -1)
  assert.equal(
    appEnv,
    process.argv[expectedIndex + 1],
    'APP_ENVが期待値と一致しません',
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
if (appEnv === 'production') {
  assert.ok(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    'productionではService Role Keyが必要です',
  );
  assert.ok(
    process.env.RETIRED_DATA_RETENTION_DAYS,
    'productionの保持期間が必要です',
  );
  assert.ok(
    process.env.AUDIT_LOG_RETENTION_DAYS,
    'productionの監査ログ保持期間が必要です',
  );
}
console.log(`${appEnv} 環境設定を検証しました。`);
