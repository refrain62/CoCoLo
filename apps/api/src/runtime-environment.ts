type AppEnvironment = 'local' | 'staging' | 'production';

type RuntimeEnvironmentInput = Record<string, string | undefined>;

export type RuntimeEnvironment = {
  appEnv: AppEnvironment;
  databaseUrl: string;
  directUrl: string;
  supabaseUrl: string;
  supabaseJwksUrl: string;
  supabaseIssuer: string;
  r2Endpoint: string;
  r2Bucket: string;
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

// 本番系はHTTPSだけを許可し、localだけloopback URLを例外として認める。
function assertUrl(name: string, value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1')
    throw new Error(
      `${name} には HTTPS またはローカルのループバック URL が必要です。`,
    );
}

function assertR2Endpoint(appEnv: AppEnvironment, value: string) {
  const url = new URL(value);
  if (appEnv === 'local' && ['localhost', '127.0.0.1'].includes(url.hostname))
    return;
  if (appEnv !== 'local' && ['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error(
      'staging / production の R2_ENDPOINT にローカルURLは使用できません。',
    );
  if (url.protocol !== 'https:')
    throw new Error(
      'R2_ENDPOINT には HTTPS のS3互換エンドポイントが必要です。',
    );
}

// 環境、Supabase接続先、R2 bucket、公開URLを相互検証し、環境混同をfail-closedで防ぐ。
export function readRuntimeEnvironment(
  environment: RuntimeEnvironmentInput,
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
  const r2Endpoint = required(environment, 'R2_ENDPOINT').replace(/\/$/, '');
  required(environment, 'R2_ACCESS_KEY_ID');
  required(environment, 'R2_SECRET_ACCESS_KEY');
  const publicAppUrl = required(environment, 'PUBLIC_APP_URL');
  const supabaseIssuer = `${supabaseUrl}/auth/v1`;

  assertUrl('SUPABASE_URL', supabaseUrl);
  assertUrl('SUPABASE_JWKS_URL', supabaseJwksUrl);
  assertR2Endpoint(appEnv, r2Endpoint);
  if (r2Bucket !== allowedBuckets[appEnv])
    throw new Error('R2_BUCKET が環境の許可値と一致しません。');

  if (appEnv === 'local' && publicAppUrl !== 'http://localhost:5173')
    throw new Error('PUBLIC_APP_URL が local 環境の許可値と一致しません。');

  const allowedUrl = environment.SUPABASE_ALLOWED_URL?.trim();
  const allowedJwksUrl = environment.SUPABASE_ALLOWED_JWKS_URL?.trim();
  const allowlist = environment.PUBLIC_APP_URL_ALLOWLIST?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (appEnv !== 'local') {
    if (!allowedUrl) throw new Error('SUPABASE_ALLOWED_URL が必要です。');
    if (!allowedJwksUrl)
      throw new Error('SUPABASE_ALLOWED_JWKS_URL が必要です。');
    if (!allowlist?.length)
      throw new Error('PUBLIC_APP_URL_ALLOWLIST が必要です。');
  }
  if (allowedUrl && allowedUrl.replace(/\/$/, '') !== supabaseUrl)
    throw new Error('SUPABASE_URL が許可された環境値と一致しません。');
  if (allowedJwksUrl && allowedJwksUrl !== supabaseJwksUrl)
    throw new Error('SUPABASE_JWKS_URL が許可された環境値と一致しません。');
  if (allowlist && !allowlist.includes(publicAppUrl))
    throw new Error('PUBLIC_APP_URL が許可リストに含まれていません。');

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
    r2Endpoint,
    r2Bucket,
  };
}
