import assert from 'node:assert/strict';
import test from 'node:test';
import { readRuntimeEnvironment } from '../dist/runtime-environment.js';
import { maliciousEnvironmentOverrides } from './fixtures/environment-malicious.mjs';

const testAdapterPolicy = {
  allowedPackages: ['@cocolo/test-rate-limit-adapter'],
  lockfilePackages: ['@cocolo/test-rate-limit-adapter'],
};

const validStagingEnvironment = {
  APP_ENV: 'staging',
  DATABASE_URL: 'postgresql://app@example.test/cocolo',
  DIRECT_URL: 'postgresql://migration@example.test/cocolo',
  SUPABASE_URL: 'https://staging.example.supabase.co',
  SUPABASE_JWKS_URL:
    'https://staging.example.supabase.co/auth/v1/.well-known/jwks.json',
  SUPABASE_ANON_KEY: 'public-anon-key',
  SUPABASE_ALLOWED_URL: 'https://staging.example.supabase.co',
  SUPABASE_ALLOWED_JWKS_URL:
    'https://staging.example.supabase.co/auth/v1/.well-known/jwks.json',
  R2_BUCKET: 'cocolo-staging-private',
  R2_ENDPOINT:
    'https://00000000000000000000000000000000.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'staging-r2-access-key',
  R2_SECRET_ACCESS_KEY: 'staging-r2-secret-key',
  PUBLIC_APP_URL: 'https://staging.example.test',
  PUBLIC_APP_URL_ALLOWLIST: 'https://staging.example.test',
  RATE_LIMIT_STORE: 'distributed',
  RATE_LIMIT_FAIL_CLOSED: 'true',
  RATE_LIMIT_ADAPTER_MODULE: '@cocolo/test-rate-limit-adapter',
  FEATURE_CONTRACT_OPERATOR_TOKEN: 'operator-secret-that-is-long-enough-123456',
  FEATURE_CONTRACT_GRANT_TOKEN: 'grant-secret-that-is-long-enough-123456',
  FEATURE_CONTRACT_PROVIDER_WEBHOOK_SECRET:
    'provider-secret-that-is-long-enough-123456',
  FEATURE_CONTRACT_OPERATOR_HOST: '127.0.0.1',
  FEATURE_CONTRACT_OPERATOR_PORT: '9876',
};

test('API起動時に許可されたstaging環境を解決する', () => {
  assert.deepEqual(
    readRuntimeEnvironment(validStagingEnvironment, {
      rateLimitAdapterPolicy: testAdapterPolicy,
    }),
    {
      appEnv: 'staging',
      databaseUrl: validStagingEnvironment.DATABASE_URL,
      directUrl: validStagingEnvironment.DIRECT_URL,
      supabaseUrl: validStagingEnvironment.SUPABASE_URL,
      supabaseAnonKey: validStagingEnvironment.SUPABASE_ANON_KEY,
      supabaseJwksUrl: validStagingEnvironment.SUPABASE_JWKS_URL,
      supabaseIssuer: 'https://staging.example.supabase.co/auth/v1',
      r2Endpoint: validStagingEnvironment.R2_ENDPOINT,
      r2Bucket: validStagingEnvironment.R2_BUCKET,
      publicAppUrl: validStagingEnvironment.PUBLIC_APP_URL,
      publicAppUrlAllowlist: [validStagingEnvironment.PUBLIC_APP_URL],
      rateLimitNamespace: 'staging',
      rateLimitStoreMode: 'distributed',
      rateLimitFailClosed: true,
      rateLimitAdapterModule: validStagingEnvironment.RATE_LIMIT_ADAPTER_MODULE,
      featureContractOperatorToken:
        validStagingEnvironment.FEATURE_CONTRACT_OPERATOR_TOKEN,
      featureContractGrantToken:
        validStagingEnvironment.FEATURE_CONTRACT_GRANT_TOKEN,
      featureContractProviderWebhookSecret:
        validStagingEnvironment.FEATURE_CONTRACT_PROVIDER_WEBHOOK_SECRET,
      featureContractOperatorHost:
        validStagingEnvironment.FEATURE_CONTRACT_OPERATOR_HOST,
      featureContractOperatorPort: 9876,
    },
  );
});

test('test stackのSupabase URLをlocal環境として許可する', () => {
  assert.doesNotThrow(() =>
    readRuntimeEnvironment({
      APP_ENV: 'local',
      DATABASE_URL: 'postgresql://app@127.0.0.1:55322/cocolo_test',
      DIRECT_URL: 'postgresql://migration@127.0.0.1:55322/cocolo_test',
      SUPABASE_URL: 'http://127.0.0.1:55321',
      SUPABASE_JWKS_URL: 'http://127.0.0.1:55321/auth/v1/.well-known/jwks.json',
      SUPABASE_ANON_KEY: 'local-anon-key',
      R2_BUCKET: 'cocolo-local',
      R2_ENDPOINT: 'http://127.0.0.1:9000',
      R2_ACCESS_KEY_ID: 'local-r2-access-key',
      R2_SECRET_ACCESS_KEY: 'local-r2-secret-key',
      PUBLIC_APP_URL: 'http://localhost:4173',
      PUBLIC_APP_URL_ALLOWLIST: 'http://localhost:4173,http://127.0.0.1:4173',
      RATE_LIMIT_STORE: 'memory',
      RATE_LIMIT_FAIL_CLOSED: 'true',
    }),
  );
});

test('stagingで分散storeとadapter moduleを省略した起動を拒否する', () => {
  const environment: Record<string, string | undefined> = {
    ...validStagingEnvironment,
  };
  delete environment.RATE_LIMIT_ADAPTER_MODULE;

  assert.throws(
    () => readRuntimeEnvironment(environment),
    /staging環境ではRATE_LIMIT_ADAPTER_MODULEが必要です。/,
  );
});

test('stagingでは課金連携listenerの認証と接続設定を必須にする', () => {
  const environment: Record<string, string | undefined> = {
    ...validStagingEnvironment,
  };
  delete environment.FEATURE_CONTRACT_OPERATOR_TOKEN;

  assert.throws(
    () =>
      readRuntimeEnvironment(environment, {
        rateLimitAdapterPolicy: testAdapterPolicy,
      }),
    /課金連携のoperator token、grant token、provider secret、host、portは同時に設定してください。/,
  );
});

test('stagingでin-memoryとfail-open設定を拒否する', () => {
  assert.throws(
    () =>
      readRuntimeEnvironment({
        ...validStagingEnvironment,
        RATE_LIMIT_STORE: 'memory',
      }),
    /staging環境のRATE_LIMIT_STOREは distributedに固定してください。/,
  );
  assert.throws(
    () =>
      readRuntimeEnvironment({
        ...validStagingEnvironment,
        RATE_LIMIT_FAIL_CLOSED: 'false',
      }),
    /RATE_LIMIT_FAIL_CLOSED は true に固定してください。/,
  );
});

test('課金連携listenerは公開wildcard hostへbindできない', () => {
  assert.throws(
    () =>
      readRuntimeEnvironment(
        {
          ...validStagingEnvironment,
          FEATURE_CONTRACT_OPERATOR_HOST: '0.0.0.0',
        },
        { rateLimitAdapterPolicy: testAdapterPolicy },
      ),
    /FEATURE_CONTRACT_OPERATOR_HOSTは公開wildcard以外/,
  );
});

test('APP_ENV未設定でAPI起動を許可しない', () => {
  const environment: Record<string, string | undefined> = {
    ...validStagingEnvironment,
  };
  delete environment.APP_ENV;

  assert.throws(
    () => readRuntimeEnvironment(environment),
    /APP_ENV には local \/ staging \/ production のいずれかを指定してください。/,
  );
});

test('R2 secret未設定ではAPI起動を許可しない', () => {
  const environment: Record<string, string | undefined> = {
    ...validStagingEnvironment,
  };
  delete environment.R2_SECRET_ACCESS_KEY;

  assert.throws(
    () => readRuntimeEnvironment(environment),
    /R2_SECRET_ACCESS_KEY が必要です。/,
  );
});

test('stagingでローカルR2 endpointを拒否する', () => {
  assert.throws(
    () =>
      readRuntimeEnvironment({
        ...validStagingEnvironment,
        R2_ENDPOINT: 'http://127.0.0.1:9000',
      }),
    /staging \/ production の R2_ENDPOINT にローカルURLは使用できません。/,
  );
});

test('SUPABASE_ISSUERの環境上書きが正本と異なる場合は拒否する', () => {
  assert.throws(
    () =>
      readRuntimeEnvironment(
        {
          ...validStagingEnvironment,
          SUPABASE_ISSUER: 'https://another-project.supabase.co/auth/v1',
        },
        { rateLimitAdapterPolicy: testAdapterPolicy },
      ),
    /SUPABASE_ISSUER が SUPABASE_URL から生成した発行者 URL と一致しません。/,
  );
});

test('stagingのSupabase許可値が実値と異なる場合は拒否する', () => {
  assert.throws(
    () =>
      readRuntimeEnvironment(
        {
          ...validStagingEnvironment,
          SUPABASE_ALLOWED_URL: 'https://production.example.supabase.co',
        },
        { rateLimitAdapterPolicy: testAdapterPolicy },
      ),
    /SUPABASE_URL が許可された環境値と一致しません。/,
  );
});

test('stagingのURLへloopback/httpを設定しても起動を許可しない', () => {
  assert.throws(
    () =>
      readRuntimeEnvironment(
        {
          ...validStagingEnvironment,
          ...maliciousEnvironmentOverrides.httpSupabaseUrl,
        },
        { rateLimitAdapterPolicy: testAdapterPolicy },
      ),
    /SUPABASE_URL はlocal以外では HTTPS が必要です。/,
  );
  assert.throws(
    () =>
      readRuntimeEnvironment(
        {
          ...validStagingEnvironment,
          ...maliciousEnvironmentOverrides.loopbackPublicAppUrl,
        },
        { rateLimitAdapterPolicy: testAdapterPolicy },
      ),
    /PUBLIC_APP_URL はlocal以外では HTTPS が必要です。/,
  );
});

test('stagingのSupabase projectと公開URL allowlistを環境変数だけで拡張できない', () => {
  assert.throws(
    () =>
      readRuntimeEnvironment(
        {
          ...validStagingEnvironment,
          ...maliciousEnvironmentOverrides.arbitrarySupabaseProject,
        },
        { rateLimitAdapterPolicy: testAdapterPolicy },
      ),
    /SUPABASE_URL が環境ごとの固定allowlistにありません。/,
  );
  assert.throws(
    () =>
      readRuntimeEnvironment(
        {
          ...validStagingEnvironment,
          ...maliciousEnvironmentOverrides.arbitraryPublicAllowlistEntry,
        },
        { rateLimitAdapterPolicy: testAdapterPolicy },
      ),
    /PUBLIC_APP_URL_ALLOWLIST が環境ごとの固定allowlistにありません。/,
  );
});
