import { createRemoteJWKSet, jwtVerify } from 'jose';

export type AuthClaims = {
  userId: string;
  issuer: string;
  audience: string;
  expiresAt: number;
};

export type TokenVerifier = (token: string) => Promise<AuthClaims>;

export type SupabaseVerifierOptions = {
  jwksUrl: string;
  issuer: string;
  audience?: string;
};

// Supabase JWKSで署名・issuer・audience・有効期限を検証し、APIが信頼できる最小claimsだけを受け取る。
export function createSupabaseTokenVerifier({
  jwksUrl,
  issuer,
  audience = 'authenticated',
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
    return {
      userId: payload.sub,
      issuer,
      audience,
      expiresAt: payload.exp,
    };
  };
}

// AuthorizationヘッダーからBearer形式だけを抽出し、他の認証方式を暗黙に受け入れない。
export function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  return match?.[1] ?? null;
}
