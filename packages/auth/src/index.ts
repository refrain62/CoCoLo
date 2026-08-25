import { createRemoteJWKSet, jwtVerify } from 'jose';

export type AuthClaims = {
  userId: string;
  issuer: string;
  audience: string;
  expiresAt: number;
  authProviders?: AuthProvider[];
  authProviderSubjects?: Partial<Record<AuthProvider, string>>;
};

export type AuthProvider = 'google' | 'line';

export type TokenVerifier = (token: string) => Promise<AuthClaims>;

export type SupabaseVerifierOptions = {
  jwksUrl: string;
  issuer: string;
  audience?: string;
  authUserUrl?: string;
  anonKey?: string;
  fetcher?: typeof fetch;
};

function readAuthProviders(payload: Record<string, unknown>) {
  const metadata = payload.app_metadata;
  if (!metadata || typeof metadata !== 'object') return [];
  const values = [
    (metadata as { provider?: unknown }).provider,
    ...(Array.isArray((metadata as { providers?: unknown }).providers)
      ? (metadata as { providers: unknown[] }).providers
      : []),
  ];
  return [...new Set(values)].filter(
    (value): value is AuthProvider => value === 'google' || value === 'line',
  );
}

function readProviderSubjects(payload: unknown) {
  if (!payload || typeof payload !== 'object') return {};
  const identities = (payload as { identities?: unknown }).identities;
  if (!Array.isArray(identities)) return {};
  const subjects: Partial<Record<AuthProvider, string>> = {};
  for (const identity of identities) {
    if (!identity || typeof identity !== 'object') continue;
    const provider = (identity as { provider?: unknown }).provider;
    const identityData = (identity as { identity_data?: unknown })
      .identity_data;
    if (provider !== 'google' && provider !== 'line') continue;
    if (!identityData || typeof identityData !== 'object') continue;
    const subject = (identityData as { sub?: unknown }).sub;
    if (
      typeof subject !== 'string' ||
      subject.length === 0 ||
      subject.length > 256
    )
      continue;
    subjects[provider] = subject;
  }
  return subjects;
}

async function resolveProviderSubjects(
  authUserUrl: string | undefined,
  anonKey: string | undefined,
  accessToken: string,
  fetcher: typeof fetch,
) {
  if (!authUserUrl || !anonKey) return {};
  const response = await fetcher(authUserUrl, {
    headers: {
      Accept: 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) throw new Error('Supabase Auth identity lookup failed');
  return readProviderSubjects(await response.json());
}

// Supabase JWKSで署名・issuer・audience・有効期限を検証し、APIが信頼できる最小claimsだけを受け取る。
export function createSupabaseTokenVerifier({
  jwksUrl,
  issuer,
  audience = 'authenticated',
  authUserUrl,
  anonKey,
  fetcher = fetch,
}: SupabaseVerifierOptions): TokenVerifier {
  const jwks = createRemoteJWKSet(new URL(jwksUrl));
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience,
    });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.exp !== 'number' ||
      payload.exp <= Math.floor(Date.now() / 1000)
    )
      throw new Error('JWT claims are incomplete or expired');
    const authProviderSubjects = await resolveProviderSubjects(
      authUserUrl,
      anonKey,
      token,
      fetcher,
    );
    const authProviders = [
      ...readAuthProviders(payload as Record<string, unknown>),
      ...Object.keys(authProviderSubjects),
    ].filter(
      (value, index, values): value is AuthProvider =>
        (value === 'google' || value === 'line') &&
        values.indexOf(value) === index,
    );
    return {
      userId: payload.sub,
      issuer,
      audience,
      expiresAt: payload.exp,
      authProviders,
      authProviderSubjects,
    };
  };
}

// AuthorizationヘッダーからBearer形式だけを抽出し、他の認証方式を暗黙に受け入れない。
export function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  return match?.[1] ?? null;
}
