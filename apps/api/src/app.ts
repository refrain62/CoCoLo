import { Hono } from 'hono';

export type ApiEnv = {
  Variables: {
    requestId: string;
  };
};

export function createApp() {
  const app = new Hono<ApiEnv>();

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
    c.set('requestId', requestId);
    c.header('x-request-id', requestId);
    await next();
  });

  app.get('/health', (c) => c.json({ status: 'ok', service: 'api' }));

  return app;
}
