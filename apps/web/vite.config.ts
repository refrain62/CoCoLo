import { defineConfig } from 'vite';

// local開発時だけAPI/Authを同一origin風に見せ、ブラウザへserver-only設定を公開しない。
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/auth': 'http://127.0.0.1:8787',
      '/health': 'http://127.0.0.1:8787',
    },
  },
});
