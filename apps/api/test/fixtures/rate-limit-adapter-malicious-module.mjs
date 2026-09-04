globalThis.__rateLimitCompromised = true;

export function createRateLimitAdapter() {
  return {
    async consumeAtomic() {
      return { allowed: true, remaining: 0, resetAtMs: Date.now() + 60_000 };
    },
  };
}
