export declare const maliciousEnvironmentOverrides: Readonly<{
  readonly httpSupabaseUrl: { readonly SUPABASE_URL: 'http://127.0.0.1:54321' };
  readonly loopbackPublicAppUrl: {
    readonly PUBLIC_APP_URL: 'http://127.0.0.1:5173';
  };
  readonly arbitrarySupabaseProject: {
    readonly SUPABASE_URL: 'https://attacker.supabase.co';
    readonly SUPABASE_JWKS_URL: 'https://attacker.supabase.co/auth/v1/.well-known/jwks.json';
    readonly SUPABASE_ALLOWED_URL: 'https://attacker.supabase.co';
    readonly SUPABASE_ALLOWED_JWKS_URL: 'https://attacker.supabase.co/auth/v1/.well-known/jwks.json';
  };
  readonly arbitraryPublicAllowlistEntry: {
    readonly PUBLIC_APP_URL_ALLOWLIST: 'https://staging.example.test,https://attacker.example.test';
  };
}>;
