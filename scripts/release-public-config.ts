import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const hashPrefix = 'cocolo-release-public-config-v1';

type PublicConfigValues = {
  viteSupabaseUrl: string | undefined;
  viteSupabaseAnonKey: string | undefined;
};

type PublicConfigIdentifierKind = 'supabase-project-ref' | 'origin-sha256';

export type PublicBuildConfig = {
  schemaVersion: 1;
  source: 'vite';
  hashAlgorithm: 'sha256';
  supabaseUrl: {
    identifierKind: PublicConfigIdentifierKind;
    identifier: string;
    sha256: string;
  };
  supabaseAnonKey: {
    sha256: string;
  };
};

function hashPublicValue(kind: string, value: string): string {
  return createHash('sha256')
    .update(`${hashPrefix}\0${kind}\0${value}`)
    .digest('hex');
}

function requiredValue(name: string, value: string | undefined): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`${name} が未設定です。`);
  return value.trim();
}

function normalizeSupabaseUrl(rawValue: string): URL {
  const parsed = new URL(rawValue);
  assert.equal(parsed.protocol, 'https:', 'Supabase URL は HTTPS が必要です。');
  assert.equal(
    parsed.username,
    '',
    'Supabase URL に認証情報を含めないでください。',
  );
  assert.equal(
    parsed.password,
    '',
    'Supabase URL に認証情報を含めないでください。',
  );
  assert.equal(
    parsed.pathname,
    '/',
    'Supabase URL は origin だけを指定してください。',
  );
  assert.equal(
    parsed.search,
    '',
    'Supabase URL に query を含めないでください。',
  );
  assert.equal(
    parsed.hash,
    '',
    'Supabase URL に fragment を含めないでください。',
  );
  return parsed;
}

function createSupabaseUrlIdentifier(url: URL): {
  identifierKind: PublicConfigIdentifierKind;
  identifier: string;
} {
  const hostname = url.hostname.toLowerCase();
  if (hostname.endsWith('.supabase.co')) {
    return {
      identifierKind: 'supabase-project-ref',
      identifier: hostname.slice(0, -'.supabase.co'.length),
    };
  }
  return {
    identifierKind: 'origin-sha256',
    identifier: hashPublicValue('supabase-url-origin', url.origin),
  };
}

// Web bundleに埋め込まれる公開設定を、生値ではなく照合用ハッシュとしてrelease manifestへ保存する。
export function createPublicBuildConfig(
  values: PublicConfigValues,
): PublicBuildConfig {
  const supabaseUrl = normalizeSupabaseUrl(
    requiredValue('VITE_SUPABASE_URL', values.viteSupabaseUrl),
  );
  const supabaseAnonKey = requiredValue(
    'VITE_SUPABASE_ANON_KEY',
    values.viteSupabaseAnonKey,
  );
  const identifier = createSupabaseUrlIdentifier(supabaseUrl);

  return {
    schemaVersion: 1,
    source: 'vite',
    hashAlgorithm: 'sha256',
    supabaseUrl: {
      ...identifier,
      sha256: hashPublicValue('supabase-url-origin', supabaseUrl.origin),
    },
    supabaseAnonKey: {
      sha256: hashPublicValue('supabase-anon-key', supabaseAnonKey),
    },
  };
}

export function createPublicBuildConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PublicBuildConfig {
  return createPublicBuildConfig({
    viteSupabaseUrl: env.VITE_SUPABASE_URL,
    viteSupabaseAnonKey: env.VITE_SUPABASE_ANON_KEY,
  });
}

function assertPublicBuildConfigShape(
  config: unknown,
): asserts config is PublicBuildConfig {
  assert.ok(config && typeof config === 'object', '公開build設定が不正です。');
  const candidate = config as PublicBuildConfig;
  assert.equal(candidate.schemaVersion, 1, '公開build設定の版が不正です。');
  assert.equal(candidate.source, 'vite', '公開build設定のsourceが不正です。');
  assert.equal(
    candidate.hashAlgorithm,
    'sha256',
    '公開build設定のhashAlgorithmが不正です。',
  );
  assert.match(
    candidate.supabaseUrl?.sha256,
    /^[0-9a-f]{64}$/,
    'Supabase URL のハッシュが不正です。',
  );
  assert.match(
    candidate.supabaseAnonKey?.sha256,
    /^[0-9a-f]{64}$/,
    'Supabase anon key のハッシュが不正です。',
  );
  assert.ok(
    candidate.supabaseUrl.identifierKind === 'supabase-project-ref' ||
      candidate.supabaseUrl.identifierKind === 'origin-sha256',
    'Supabase URL の識別子種別が不正です。',
  );
  assert.ok(
    typeof candidate.supabaseUrl.identifier === 'string' &&
      candidate.supabaseUrl.identifier.length > 0,
    'Supabase URL の識別子が不正です。',
  );
}

export function assertPublicBuildConfigMatches(
  config: unknown,
  allowedValues: PublicConfigValues,
): PublicBuildConfig {
  assertPublicBuildConfigShape(config);
  const expected = createPublicBuildConfig(allowedValues);
  if (config.supabaseUrl.sha256 !== expected.supabaseUrl.sha256)
    throw new Error(
      'artifact の Supabase URL が昇格先環境の許可値と一致しません。',
    );
  if (config.supabaseAnonKey.sha256 !== expected.supabaseAnonKey.sha256)
    throw new Error(
      'artifact の Supabase anon key が昇格先環境の許可値と一致しません。',
    );
  return config;
}
