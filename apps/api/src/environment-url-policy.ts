export type AppEnvironment = 'local' | 'staging' | 'production';

type EnvironmentUrlPolicy = {
  supabaseUrls: readonly string[];
  supabaseJwksUrls: readonly string[];
  publicAppUrls: readonly string[];
};

// Supabase project、JWKS path、公開hostを環境ごとにコードで固定し、環境変数だけで許可範囲を拡張できないようにする。
export const environmentUrlPolicies: Readonly<
  Record<AppEnvironment, EnvironmentUrlPolicy>
> = {
  local: {
    supabaseUrls: ['http://127.0.0.1:54321'],
    supabaseJwksUrls: ['http://127.0.0.1:54321/auth/v1/.well-known/jwks.json'],
    publicAppUrls: [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4173',
      'http://127.0.0.1:4173',
    ],
  },
  staging: {
    supabaseUrls: ['https://staging.example.supabase.co'],
    supabaseJwksUrls: [
      'https://staging.example.supabase.co/auth/v1/.well-known/jwks.json',
    ],
    publicAppUrls: ['https://staging.example.test'],
  },
  production: {
    supabaseUrls: ['https://production.example.supabase.co'],
    supabaseJwksUrls: [
      'https://production.example.supabase.co/auth/v1/.well-known/jwks.json',
    ],
    publicAppUrls: ['https://production.example.test'],
  },
};

export type EnvironmentUrlInput = {
  supabaseUrl: string;
  supabaseJwksUrl: string;
  publicAppUrl: string;
  supabaseAllowedUrl?: string;
  supabaseAllowedJwksUrl?: string;
  publicAppUrlAllowlist?: string;
};

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

function assertScheme(
  appEnv: AppEnvironment,
  name: string,
  value: string,
): void {
  const url = new URL(value);
  if (appEnv !== 'local' && url.protocol !== 'https:')
    throw new Error(`${name} はlocal以外では HTTPS が必要です。`);
  if (appEnv === 'local' && !['http:', 'https:'].includes(url.protocol))
    throw new Error(`${name} のschemeが許可されていません。`);
}

function assertFixedValue(
  name: string,
  value: string,
  allowedValues: readonly string[],
): void {
  if (!allowedValues.includes(value))
    throw new Error(`${name} が環境ごとの固定allowlistにありません。`);
}

// 起動経路と配置前検証で同一のURL境界を使い、loopback・任意host・任意allowlist追加を拒否する。
export function validateEnvironmentUrls(
  appEnv: AppEnvironment,
  input: EnvironmentUrlInput,
): void {
  const policy = environmentUrlPolicies[appEnv];
  const supabaseUrl = withoutTrailingSlash(input.supabaseUrl);
  const supabaseAllowedUrl = input.supabaseAllowedUrl
    ? withoutTrailingSlash(input.supabaseAllowedUrl)
    : undefined;

  assertScheme(appEnv, 'SUPABASE_URL', supabaseUrl);
  assertScheme(appEnv, 'SUPABASE_JWKS_URL', input.supabaseJwksUrl);
  assertScheme(appEnv, 'PUBLIC_APP_URL', input.publicAppUrl);
  assertFixedValue('SUPABASE_URL', supabaseUrl, policy.supabaseUrls);
  assertFixedValue(
    'SUPABASE_JWKS_URL',
    input.supabaseJwksUrl,
    policy.supabaseJwksUrls,
  );
  assertFixedValue('PUBLIC_APP_URL', input.publicAppUrl, policy.publicAppUrls);

  if (supabaseAllowedUrl !== undefined) {
    if (supabaseAllowedUrl !== supabaseUrl)
      throw new Error('SUPABASE_URL が許可された環境値と一致しません。');
    assertFixedValue(
      'SUPABASE_ALLOWED_URL',
      supabaseAllowedUrl,
      policy.supabaseUrls,
    );
  }
  if (input.supabaseAllowedJwksUrl !== undefined) {
    if (input.supabaseAllowedJwksUrl !== input.supabaseJwksUrl)
      throw new Error('SUPABASE_JWKS_URL が許可された環境値と一致しません。');
    assertFixedValue(
      'SUPABASE_ALLOWED_JWKS_URL',
      input.supabaseAllowedJwksUrl,
      policy.supabaseJwksUrls,
    );
  }

  if (input.publicAppUrlAllowlist !== undefined) {
    const configuredUrls = input.publicAppUrlAllowlist
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!configuredUrls.length)
      throw new Error('PUBLIC_APP_URL_ALLOWLIST が必要です。');
    for (const configuredUrl of configuredUrls)
      assertFixedValue(
        'PUBLIC_APP_URL_ALLOWLIST',
        configuredUrl,
        policy.publicAppUrls,
      );
    if (!configuredUrls.includes(input.publicAppUrl))
      throw new Error('PUBLIC_APP_URL が許可リストに含まれていません。');
  }
}
