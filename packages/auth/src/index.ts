export type AuthClaims = {
  userId: string;
  issuer: string;
  audience: string;
  expiresAt: number;
};

export type TokenVerifier = (token: string) => Promise<AuthClaims>;

export function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  return match?.[1] ?? null;
}
