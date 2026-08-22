import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.vitest.ts', 'apps/web/src/**/*.vitest.ts'],
  },
});
