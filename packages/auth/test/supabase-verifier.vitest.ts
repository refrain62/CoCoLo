import {
  exportJWK,
  generateKeyPair,
  SignJWT,
} from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { createSupabaseTokenVerifier } from '../src/index.js';

const issuer = 'https://example.supabase.co/auth/v1';
const jwksUrl = 'https://example.supabase.co/auth/v1/.well-known/jwks.json';
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Supabase JWT verifier', () => {
  it('署名、issuer、audience、subject、期限を検証する', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    const kid = 'test-key';
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ keys: [{ ...jwk, kid, alg: 'RS256' }] }), {
        headers: { 'content-type': 'application/json' },
      });
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(issuer)
      .setAudience('authenticated')
      .setSubject('user-a')
      .setExpirationTime('5m')
      .sign(privateKey);

    const claims = await createSupabaseTokenVerifier({
      jwksUrl,
      issuer,
    })(token);

    expect(claims.userId).toBe('user-a');
    expect(claims.audience).toBe('authenticated');
  });

  it('期限切れJWTを拒否する', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    const kid = 'expired-key';
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ keys: [{ ...jwk, kid, alg: 'RS256' }] }), {
        headers: { 'content-type': 'application/json' },
      });
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(issuer)
      .setAudience('authenticated')
      .setSubject('user-a')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .sign(privateKey);

    await expect(
      createSupabaseTokenVerifier({ jwksUrl, issuer })(token),
    ).rejects.toThrow();
  });
});
