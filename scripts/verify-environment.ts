import assert from 'node:assert/strict';
import {
  type AppEnvironment,
  validateEnvironmentUrls,
} from '../apps/api/src/environment-url-policy.ts';
import {
  bundledRateLimitAdapterPackages,
  readPnpmLockfilePackageNames,
  validateRateLimitAdapterModule,
} from '../apps/api/src/security/rate-limit-adapter-policy.ts';

const lockfilePackages = readPnpmLockfilePackageNames();

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
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseJwksUrl = process.env.SUPABASE_JWKS_URL;
const publicAppUrl = process.env.PUBLIC_APP_URL;
assert.ok(supabaseUrl, 'SUPABASE_URL が必要です');
assert.ok(supabaseJwksUrl, 'SUPABASE_JWKS_URL が必要です');
assert.ok(process.env.SUPABASE_ANON_KEY, 'SUPABASE_ANON_KEY が必要です');
assert.ok(process.env.R2_BUCKET, 'R2_BUCKET が必要です');
assert.ok(process.env.R2_ENDPOINT, 'R2_ENDPOINT が必要です');
assert.ok(process.env.R2_ACCESS_KEY_ID, 'R2_ACCESS_KEY_ID が必要です');
assert.ok(process.env.R2_SECRET_ACCESS_KEY, 'R2_SECRET_ACCESS_KEY が必要です');
assert.ok(publicAppUrl, 'PUBLIC_APP_URL が必要です');
assert.ok(process.env.RATE_LIMIT_STORE, 'RATE_LIMIT_STORE が必要です');
assert.equal(
  process.env.RATE_LIMIT_STORE,
  appEnv === 'local' ? 'memory' : 'distributed',
  `${appEnv}環境のRATE_LIMIT_STOREが許可値と一致しません。`,
);
assert.equal(
  process.env.RATE_LIMIT_FAIL_CLOSED,
  'true',
  'RATE_LIMIT_FAIL_CLOSED は true に固定してください。',
);
const rateLimitAdapterModule = process.env.RATE_LIMIT_ADAPTER_MODULE?.trim();
if (appEnv === 'local')
  assert.equal(
    rateLimitAdapterModule ?? '',
    '',
    'local環境ではRATE_LIMIT_ADAPTER_MODULEを設定できません。',
  );
else {
  if (!rateLimitAdapterModule)
    throw new Error(`${appEnv}環境ではRATE_LIMIT_ADAPTER_MODULEが必要です。`);
  validateRateLimitAdapterModule(rateLimitAdapterModule, {
    allowedPackages: bundledRateLimitAdapterPackages,
    lockfilePackages,
  });
}
if (allowed[appEnv].R2_BUCKET)
  assert.equal(process.env.R2_BUCKET, allowed[appEnv].R2_BUCKET);
if (
  appEnv !== 'local' &&
  process.env.R2_ENDPOINT &&
  !process.env.R2_ENDPOINT.startsWith('https://')
)
  throw new Error(
    'staging / production の R2_ENDPOINT には HTTPS が必要です。',
  );
if (allowed[appEnv].PUBLIC_APP_URL)
  assert.equal(process.env.PUBLIC_APP_URL, allowed[appEnv].PUBLIC_APP_URL);
if (appEnv !== 'local') {
  assert.ok(
    process.env.FEATURE_CONTRACT_OPERATOR_TOKEN,
    `${appEnv} 環境では FEATURE_CONTRACT_OPERATOR_TOKEN が必要です。`,
  );
  assert.ok(
    process.env.FEATURE_CONTRACT_GRANT_TOKEN,
    `${appEnv} 環境では FEATURE_CONTRACT_GRANT_TOKEN が必要です。`,
  );
  assert.ok(
    process.env.FEATURE_CONTRACT_PROVIDER_WEBHOOK_SECRET,
    `${appEnv} 環境では FEATURE_CONTRACT_PROVIDER_WEBHOOK_SECRET が必要です。`,
  );
  assert.ok(
    process.env.FEATURE_CONTRACT_OPERATOR_HOST,
    `${appEnv} 環境では FEATURE_CONTRACT_OPERATOR_HOST が必要です。`,
  );
  assert.ok(
    process.env.FEATURE_CONTRACT_OPERATOR_PORT,
    `${appEnv} 環境では FEATURE_CONTRACT_OPERATOR_PORT が必要です。`,
  );
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
validateEnvironmentUrls(appEnv, {
  supabaseUrl,
  supabaseJwksUrl,
  publicAppUrl,
  supabaseAllowedUrl: process.env.SUPABASE_ALLOWED_URL,
  supabaseAllowedJwksUrl: process.env.SUPABASE_ALLOWED_JWKS_URL,
  publicAppUrlAllowlist: process.env.PUBLIC_APP_URL_ALLOWLIST,
});
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
