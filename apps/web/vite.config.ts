import { defineConfig } from 'vite';

// local開発時だけAPI/Authを同一origin風に見せ、ブラウザへserver-only設定を公開しない。
export default defineConfig({
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    proxy: {
      '/api': process.env.VITE_API_PROXY_URL ?? 'http://127.0.0.1:8787',
      '/auth': process.env.VITE_API_PROXY_URL ?? 'http://127.0.0.1:8787',
      '/health': process.env.VITE_API_PROXY_URL ?? 'http://127.0.0.1:8787',
    },
  },
});
