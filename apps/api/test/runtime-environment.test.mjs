import assert from 'node:assert/strict';
import test from 'node:test';
import { readRuntimeEnvironment } from '../dist/runtime-environment.js';

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
  PUBLIC_APP_URL: 'https://staging.example.test',
  PUBLIC_APP_URL_ALLOWLIST: 'https://staging.example.test',
};

test('API起動時に許可されたstaging環境を解決する', () => {
  assert.deepEqual(readRuntimeEnvironment(validStagingEnvironment), {
    appEnv: 'staging',
    databaseUrl: validStagingEnvironment.DATABASE_URL,
    directUrl: validStagingEnvironment.DIRECT_URL,
    supabaseUrl: validStagingEnvironment.SUPABASE_URL,
    supabaseJwksUrl: validStagingEnvironment.SUPABASE_JWKS_URL,
    supabaseIssuer: 'https://staging.example.supabase.co/auth/v1',
  });
});

test('APP_ENV未設定でAPI起動を許可しない', () => {
  const environment = { ...validStagingEnvironment };
  delete environment.APP_ENV;

  assert.throws(
    () => readRuntimeEnvironment(environment),
    /APP_ENV には local \/ staging \/ production のいずれかを指定してください。/,
  );
});

test('SUPABASE_ISSUERの環境上書きが正本と異なる場合は拒否する', () => {
  assert.throws(
    () =>
      readRuntimeEnvironment({
        ...validStagingEnvironment,
        SUPABASE_ISSUER: 'https://another-project.supabase.co/auth/v1',
      }),
    /SUPABASE_ISSUER が SUPABASE_URL から生成した発行者 URL と一致しません。/,
  );
});

test('stagingのSupabase許可値が実値と異なる場合は拒否する', () => {
  assert.throws(
    () =>
      readRuntimeEnvironment({
        ...validStagingEnvironment,
        SUPABASE_ALLOWED_URL: 'https://production.example.supabase.co',
      }),
    /SUPABASE_URL が許可された環境値と一致しません。/,
  );
});
