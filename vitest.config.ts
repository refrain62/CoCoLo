import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // test:unitはworkspace packageのbuild前に実行されるため、UIソースを直接解決する。
    alias: {
      '@cocolo/ui': fileURLToPath(
        new URL('./packages/ui/src/index.tsx', import.meta.url),
      ),
    },
  },
  test: {
    include: ['packages/**/test/**/*.vitest.ts', 'apps/web/src/**/*.vitest.ts'],
  },
});
