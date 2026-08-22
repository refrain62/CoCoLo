export const maliciousEnvironmentOverrides = Object.freeze({
  httpSupabaseUrl: {
    SUPABASE_URL: 'http://127.0.0.1:54321',
  },
  loopbackPublicAppUrl: {
    PUBLIC_APP_URL: 'http://127.0.0.1:5173',
  },
  arbitrarySupabaseProject: {
    SUPABASE_URL: 'https://attacker.supabase.co',
    SUPABASE_JWKS_URL:
      'https://attacker.supabase.co/auth/v1/.well-known/jwks.json',
    SUPABASE_ALLOWED_URL: 'https://attacker.supabase.co',
    SUPABASE_ALLOWED_JWKS_URL:
      'https://attacker.supabase.co/auth/v1/.well-known/jwks.json',
  },
  arbitraryPublicAllowlistEntry: {
    PUBLIC_APP_URL_ALLOWLIST:
      'https://staging.example.test,https://attacker.example.test',
  },
});
