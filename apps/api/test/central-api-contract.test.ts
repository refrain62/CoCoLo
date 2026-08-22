import assert from 'node:assert/strict';
import test from 'node:test';
import { featureEnvelopeResponseSchema } from '@cocolo/contracts/runtime-response';
import { createApp } from '../dist/app.js';
import {
  createCentralDatabaseAdapter,
  createCentralRateLimitMiddleware,
} from '../dist/central-dependencies.js';

const TENANT_ID = '00000000-0000-7000-8000-000000000001';

function createContractApp() {
  return createApp({
    verifyToken: async () => ({
      userId: 'contract-user',
      issuer: 'https://example.supabase.co/auth/v1',
      audience: 'authenticated',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    }),
    membershipRepository: {
      findActiveByUserId: async () => ({
        tenantId: TENANT_ID,
        role: 'guardian' as const,
      }),
    },
    central: { logSink: () => undefined },
  });
}

test('中央sessionの成功応答は共通data envelope契約を満たす', async () => {
  const response = await createContractApp().request('/api/v1/session', {
    headers: { authorization: 'Bearer contract-token' },
  });
  const body = (await response.json()) as unknown;

  assert.equal(response.status, 200);
  assert.equal(featureEnvelopeResponseSchema.safeParse(body).success, true);
  assert.deepEqual((body as { data: unknown }).data, {
    tenantId: TENANT_ID,
    role: 'guardian',
  });
});

test('中央の未接続応答はPIIを含まない共通error契約である', async () => {
  const response = await createContractApp().request('/api/v1/events', {
    headers: { authorization: 'Bearer contract-token' },
  });
  const body = (await response.json()) as {
    error?: {
      code?: string;
      message?: string;
      details?: unknown;
      requestId?: string;
    };
  };

  assert.equal(response.status, 503);
  assert.deepEqual(body.error, {
    code: 'FEATURE_NOT_CONFIGURED',
    message: 'FS-EVTの中央依存性が設定されていません。',
    details: {},
    requestId: body.error?.requestId,
  });
  assert.equal(typeof body.error?.requestId, 'string');
});

test('DB adapterはschema未統合を明示し、本番rate limit未接続は起動時に停止する', () => {
  const database = createCentralDatabaseAdapter({});
  assert.equal(database.featureSchemaReady, false);
  assert.match(database.unavailableReason, /schema/);
  assert.throws(
    () => createCentralRateLimitMiddleware({ requireDistributed: true }),
    /分散rate-limit store/,
  );
});
