import {
  type AppEnvironment,
  validateEnvironmentUrls,
} from './environment-url-policy.js';
import type { RateLimitStoreMode } from './security/rate-limit-adapter.js';
import {
  type RateLimitAdapterModulePolicy,
  validateRateLimitAdapterModule,
} from './security/rate-limit-adapter-policy.js';

type RuntimeEnvironmentInput = Record<string, string | undefined>;

export type RuntimeEnvironment = {
  appEnv: AppEnvironment;
  databaseUrl: string;
  directUrl: string;
  supabaseUrl: string;
  supabaseJwksUrl: string;
  supabaseIssuer: string;
  rateLimitNamespace: AppEnvironment;
  rateLimitStoreMode: RateLimitStoreMode;
  rateLimitFailClosed: true;
  rateLimitAdapterModule?: string;
};

const allowedBuckets: Record<AppEnvironment, string> = {
  local: 'cocolo-local',
  staging: 'cocolo-staging-private',
  production: 'cocolo-production-private',
};

// 必須設定を起動直後に検証し、未設定値を下流の接続処理まで持ち込まない。
function required(environment: RuntimeEnvironmentInput, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} が必要です。`);
  return value;
}

// 環境、Supabase接続先、R2 bucket、公開URLを相互検証し、環境混同をfail-closedで防ぐ。
export type RuntimeEnvironmentOptions = {
  rateLimitAdapterPolicy?: RateLimitAdapterModulePolicy;
};

export function readRuntimeEnvironment(
  environment: RuntimeEnvironmentInput,
  options: RuntimeEnvironmentOptions = {},
): RuntimeEnvironment {
  const appEnv = environment.APP_ENV?.trim();
  if (appEnv !== 'local' && appEnv !== 'staging' && appEnv !== 'production')
    throw new Error(
      'APP_ENV には local / staging / production のいずれかを指定してください。',
    );

  const databaseUrl = required(environment, 'DATABASE_URL');
  const directUrl = required(environment, 'DIRECT_URL');
  const supabaseUrl = required(environment, 'SUPABASE_URL').replace(/\/$/, '');
  const supabaseJwksUrl = required(environment, 'SUPABASE_JWKS_URL');
  required(environment, 'SUPABASE_ANON_KEY');
  const r2Bucket = required(environment, 'R2_BUCKET');
  const publicAppUrl = required(environment, 'PUBLIC_APP_URL');
  const rateLimitStoreMode = required(
    environment,
    'RATE_LIMIT_STORE',
  ) as RateLimitStoreMode;
  const rateLimitFailClosed = required(environment, 'RATE_LIMIT_FAIL_CLOSED');
  const rateLimitAdapterModule = environment.RATE_LIMIT_ADAPTER_MODULE?.trim();
  const supabaseIssuer = `${supabaseUrl}/auth/v1`;

  if (r2Bucket !== allowedBuckets[appEnv])
    throw new Error('R2_BUCKET が環境の許可値と一致しません。');

  if (rateLimitFailClosed !== 'true')
    throw new Error('RATE_LIMIT_FAIL_CLOSED は true に固定してください。');
  if (appEnv === 'local') {
    if (rateLimitStoreMode !== 'memory')
      throw new Error(
        'local環境のRATE_LIMIT_STOREは memoryに固定してください。',
      );
    if (rateLimitAdapterModule)
      throw new Error(
        'local環境ではRATE_LIMIT_ADAPTER_MODULEを設定できません。',
      );
  } else {
    if (rateLimitStoreMode !== 'distributed')
      throw new Error(
        `${appEnv}環境のRATE_LIMIT_STOREは distributedに固定してください。`,
      );
    if (!rateLimitAdapterModule)
      throw new Error(`${appEnv}環境ではRATE_LIMIT_ADAPTER_MODULEが必要です。`);
    validateRateLimitAdapterModule(
      rateLimitAdapterModule,
      options.rateLimitAdapterPolicy,
    );
  }

  const allowedUrl = environment.SUPABASE_ALLOWED_URL?.trim();
  const allowedJwksUrl = environment.SUPABASE_ALLOWED_JWKS_URL?.trim();
  const allowlist = environment.PUBLIC_APP_URL_ALLOWLIST;
  if (appEnv !== 'local') {
    if (!allowedUrl) throw new Error('SUPABASE_ALLOWED_URL が必要です。');
    if (!allowedJwksUrl)
      throw new Error('SUPABASE_ALLOWED_JWKS_URL が必要です。');
    if (!allowlist?.length)
      throw new Error('PUBLIC_APP_URL_ALLOWLIST が必要です。');
  }
  validateEnvironmentUrls(appEnv, {
    supabaseUrl,
    supabaseJwksUrl,
    publicAppUrl,
    supabaseAllowedUrl: allowedUrl,
    supabaseAllowedJwksUrl: allowedJwksUrl,
    publicAppUrlAllowlist: allowlist,
  });

  const configuredIssuer = environment.SUPABASE_ISSUER?.trim();
  if (configuredIssuer && configuredIssuer !== supabaseIssuer)
    throw new Error(
      'SUPABASE_ISSUER が SUPABASE_URL から生成した発行者 URL と一致しません。',
    );

  if (appEnv === 'production') {
    required(environment, ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_'));
    required(environment, 'RETIRED_DATA_RETENTION_DAYS');
    required(environment, 'AUDIT_LOG_RETENTION_DAYS');
  }

  return {
    appEnv,
    databaseUrl,
    directUrl,
    supabaseUrl,
    supabaseJwksUrl,
    supabaseIssuer,
    rateLimitNamespace: appEnv,
    rateLimitStoreMode,
    rateLimitFailClosed: true,
    ...(rateLimitAdapterModule ? { rateLimitAdapterModule } : {}),
  };
}
