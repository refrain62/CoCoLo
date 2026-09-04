// いずれもloadDistributedRateLimitAdapterへ渡す前に拒否し、実行しないfixture。
export const maliciousRateLimitAdapterModules = [
  'file:///tmp/rate-limit-adapter.mjs',
  'data:text/javascript,globalThis.__rateLimitCompromised=true',
  'node:fs',
  'fs',
  '../fixtures/rate-limit-adapter.mjs',
];
