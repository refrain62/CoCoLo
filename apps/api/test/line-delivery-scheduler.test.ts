import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createLineDeliveryProcessor,
  createLineMessagingTransport,
  createPostgresLineDeliveryRepository,
  type LineDeliveryClaim,
  type LineDeliveryClaimRepository,
  type LineDeliveryDatabase,
  type LineDeliverySchedulerConfig,
  loadLineDeliveryWorker,
  readLineDeliverySchedulerConfig,
  runLineDeliveryScheduler,
} from '../dist/line-delivery-scheduler.js';

const NOW = new Date('2026-08-23T00:00:00.000Z');
const ALLOWLIST = JSON.stringify({
  staging: {
    hosts: ['staging-db.internal'],
    names: ['cocolo_staging'],
    roles: ['line_delivery_worker'],
  },
  production: {
    hosts: ['production-db.internal'],
    names: ['cocolo_production'],
    roles: ['line_delivery_worker'],
  },
});
const MIGRATION = readFileSync(
  new URL(
    '../../../packages/db/prisma/migrations/20260823100000_line_delivery_scheduler/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const HARDENING_MIGRATION = readFileSync(
  new URL(
    '../../../packages/db/prisma/migrations/20260823110000_line_delivery_security_hardening/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const PROVIDER_RETRY_MIGRATION = readFileSync(
  new URL(
    '../../../packages/db/prisma/migrations/20260823120000_line_delivery_provider_retry_key/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const UNKNOWN_LEASE_MIGRATION = readFileSync(
  new URL(
    '../../../packages/db/prisma/migrations/20260823130000_line_delivery_unknown_lease_guard/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const EVENT_LINE_DELIVERY_MIGRATION = readFileSync(
  new URL(
    '../../../packages/db/prisma/migrations/20260824100000_event_line_delivery_schedule/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const CONNECTION_GENERATION_MIGRATION = readFileSync(
  new URL(
    '../../../packages/db/prisma/migrations/20260824110000_line_delivery_connection_generation/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const GROUP_REUSE_MIGRATION = readFileSync(
  new URL(
    '../../../packages/db/prisma/migrations/20260824120000_line_delivery_group_reuse_guard/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const CONNECTION_GUARD_MIGRATION = readFileSync(
  new URL(
    '../../../packages/db/prisma/migrations/20260824130000_line_delivery_connection_guard/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const SCHEDULER_SOURCE = readFileSync(
  new URL('../src/line-delivery-scheduler.ts', import.meta.url),
  'utf8',
);

function environment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    APP_ENV: 'staging',
    LINE_DELIVERY_WORKER_DATABASE_URL:
      'postgresql://line_delivery_worker:secret@staging-db.internal:5432/cocolo_staging',
    LINE_DELIVERY_DB_ALLOWLIST: ALLOWLIST,
    LINE_CHANNEL_ACCESS_TOKEN: 'channel-access-token',
    LINE_DELIVERY_TRANSPORT: 'real',
    LINE_DELIVERY_WORKER_MODULE: './line-delivery-worker.js',
    LINE_DELIVERY_BATCH_SIZE: '4',
    LINE_DELIVERY_SCHEDULER_MAX_ATTEMPTS: '3',
    LINE_DELIVERY_SCHEDULER_ATTEMPT: '1',
    LINE_DELIVERY_RETRY_BASE_DELAY_SECONDS: '2',
    LINE_DELIVERY_NOTIFICATION_MAX_ATTEMPTS: '5',
    LINE_DELIVERY_SEND_TIMEOUT_MS: '100',
    LINE_DELIVERY_LEASE_MS: '500',
    ...overrides,
  };
}

function config(
  overrides: Partial<LineDeliverySchedulerConfig> = {},
): LineDeliverySchedulerConfig {
  return {
    appEnv: 'staging',
    transport: 'real',
    workerModule: './line-delivery-worker.js',
    maxItems: 4,
    attempt: 1,
    maxAttempts: 3,
    retryBaseDelayMs: 2000,
    notificationMaxAttempts: 5,
    sendTimeoutMs: 100,
    leaseMs: 500,
    database: {
      host: 'staging-db.internal',
      name: 'cocolo_staging',
      role: 'line_delivery_worker',
    },
    ...overrides,
  };
}

function claim(overrides: Partial<LineDeliveryClaim> = {}): LineDeliveryClaim {
  return {
    notificationId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    destination: 'line-group',
    title: 'title',
    body: 'private body',
    deepLink: 'https://app.example.test/notification/1',
    idempotencyKey: 'line-delivery-11111111-1111-4111-8111-111111111111',
    providerRetryKey: '11111111-1111-4111-8111-111111111111',
    payloadHash: 'a'.repeat(64),
    attempt: 1,
    attemptToken: '33333333-3333-4333-8333-333333333333',
    leaseExpiresAt: new Date(NOW.getTime() + 500),
    ...overrides,
  };
}

function repositoryFor(
  currentClaim: LineDeliveryClaim | null = claim(),
): LineDeliveryClaimRepository & {
  sent: unknown[];
  failed: unknown[];
} {
  const sent: unknown[] = [];
  const failed: unknown[] = [];
  return {
    sent,
    failed,
    claimDue: async () => currentClaim,
    markSent: async (input) => {
      sent.push(input);
      return 'sent';
    },
    markFailed: async (input) => {
      failed.push(input);
      return 'failed';
    },
    markUnknown: async (input) => {
      failed.push(input);
      return 'unknown';
    },
  };
}

test('APP_ENVとDB host/name/roleの環境別allowlistをfail-closed検証する', () => {
  const parsed = readLineDeliverySchedulerConfig(environment());
  assert.deepEqual(parsed.database, {
    host: 'staging-db.internal',
    name: 'cocolo_staging',
    role: 'line_delivery_worker',
  });
  assert.throws(
    () => readLineDeliverySchedulerConfig(environment({ APP_ENV: 'local' })),
    /staging \/ production/,
  );
  assert.throws(
    () =>
      readLineDeliverySchedulerConfig(
        environment({
          LINE_DELIVERY_WORKER_DATABASE_URL:
            'postgresql://line_delivery_worker:x@production-db.internal/cocolo_production',
        }),
      ),
    /APP_ENVのDB許可値/,
  );
  assert.throws(
    () =>
      readLineDeliverySchedulerConfig(
        environment({
          LINE_DELIVERY_WORKER_DATABASE_URL:
            'postgresql://cocolo_app:x@staging-db.internal/cocolo_staging',
          LINE_DELIVERY_DB_ALLOWLIST: JSON.stringify({
            staging: {
              hosts: ['staging-db.internal'],
              names: ['cocolo_staging'],
              roles: ['cocolo_app'],
            },
            production: {
              hosts: ['production-db.internal'],
              names: ['cocolo_production'],
              roles: ['cocolo_app'],
            },
          }),
        }),
      ),
    /専用worker role/,
  );
  assert.throws(
    () =>
      readLineDeliverySchedulerConfig(
        environment({
          LINE_DELIVERY_DB_ALLOWLIST: JSON.stringify({
            staging: {
              hosts: ['same'],
              names: ['same'],
              roles: ['line_delivery_worker'],
            },
            production: {
              hosts: ['same'],
              names: ['same'],
              roles: ['line_delivery_worker'],
            },
          }),
        }),
      ),
    /重複/,
  );
});

test('leaseMsは送信timeoutの2倍以上でない設定を拒否する', () => {
  assert.throws(
    () =>
      readLineDeliverySchedulerConfig(
        environment({ LINE_DELIVERY_LEASE_MS: '100' }),
      ),
    /LINE_DELIVERY_LEASE_MS/,
  );
});

test('必須設定、件数、worker moduleをfail-closed検証する', () => {
  assert.throws(
    () =>
      readLineDeliverySchedulerConfig(
        environment({ LINE_CHANNEL_ACCESS_TOKEN: undefined }),
      ),
    /LINE_CHANNEL_ACCESS_TOKEN/,
  );
  assert.throws(
    () =>
      readLineDeliverySchedulerConfig(
        environment({ LINE_DELIVERY_BATCH_SIZE: '101' }),
      ),
    /LINE_DELIVERY_BATCH_SIZE/,
  );
  assert.throws(
    () =>
      readLineDeliverySchedulerConfig(
        environment({ LINE_DELIVERY_WORKER_MODULE: '../worker.js' }),
      ),
    /LINE_DELIVERY_WORKER_MODULE/,
  );
  const parsed = readLineDeliverySchedulerConfig(environment());
  assert.equal(parsed.maxItems, 4);
  assert.equal(parsed.sendTimeoutMs, 100);
  assert.equal(parsed.leaseMs, 500);
});

test('schedulerはworkerへclaim処理を渡して件数上限を委譲する', async () => {
  let receivedMaxItems = 0;
  let processed = 0;
  const result = await runLineDeliveryScheduler({
    config: config({ maxItems: 7 }),
    worker: {
      run: async ({ maxItems, processOne }) => {
        receivedMaxItems = maxItems;
        await processOne({ signal: new AbortController().signal });
        processed += 1;
        return 'sent';
      },
    },
    processor: { processOne: async () => 'sent' },
    now: () => NOW,
  });
  assert.equal(result.status, 'completed');
  assert.equal(receivedMaxItems, 7);
  assert.equal(processed, 1);
});

test('release成果物のworker moduleは実際にloadして件数上限まで処理する', async () => {
  const worker = await loadLineDeliveryWorker('./line-delivery-worker.js');
  let processed = 0;
  const result = await worker.run({
    maxItems: 2,
    signal: new AbortController().signal,
    processOne: async () => {
      processed += 1;
      return processed === 1 ? 'sent' : 'idle';
    },
  });
  assert.equal(result, 'sent');
  assert.equal(processed, 2);
});

test('同時workerのclaim競合はDB状態により一件だけ取得し、schedulerは重複実行しない', async () => {
  let claimed = false;
  const repository: LineDeliveryClaimRepository = {
    claimDue: async () => {
      if (claimed) return null;
      claimed = true;
      return claim();
    },
    markSent: async () => 'sent',
    markFailed: async () => 'failed',
    markUnknown: async () => 'unknown',
  };
  const processor = createLineDeliveryProcessor({
    repository,
    transport: { send: async () => ({ providerMessageId: 'provider-id' }) },
    maxAttempts: 5,
    leaseMs: 500,
    sendTimeoutMs: 100,
    retryBaseDelayMs: 1000,
    now: () => NOW,
  });
  const [first, second] = await Promise.all([
    processor.processOne({ signal: new AbortController().signal }),
    processor.processOne({ signal: new AbortController().signal }),
  ]);
  assert.deepEqual([first, second].sort(), ['idle', 'sent']);
});

test('claim transactionは外部LINE送信前に終了し、attempt token付きsent確定を行う', async () => {
  let transactionActive = false;
  let transactionCalls = 0;
  const database: LineDeliveryDatabase = {
    transaction: async (work) => {
      transactionCalls += 1;
      transactionActive = true;
      try {
        return await work({
          queryRaw: async <Row>(
            strings: TemplateStringsArray,
            ..._values: unknown[]
          ): Promise<Row> => {
            const sql = Array.from(strings).join(' ');
            if (sql.includes('app_claim_line_delivery_outbox'))
              return [
                {
                  notification_id: claim().notificationId,
                  tenant_id: claim().tenantId,
                  destination: claim().destination,
                  title: claim().title,
                  body: claim().body,
                  deep_link: claim().deepLink,
                  idempotency_key: claim().idempotencyKey,
                  provider_retry_key: claim().providerRetryKey,
                  payload_hash: claim().payloadHash,
                  attempt: 1,
                  attempt_token: claim().attemptToken,
                  lease_expires_at: claim().leaseExpiresAt,
                },
              ] as Row;
            if (sql.includes('app_validate_line_delivery_claim'))
              return [{ current: true }] as Row;
            return [{ outcome: 'sent' }] as Row;
          },
        });
      } finally {
        transactionActive = false;
      }
    },
  };
  const repository = createPostgresLineDeliveryRepository(database);
  let sentWhileTransaction = true;
  const processor = createLineDeliveryProcessor({
    repository,
    transport: {
      send: async () => {
        sentWhileTransaction = transactionActive;
        return { providerMessageId: 'provider-request-id' };
      },
    },
    maxAttempts: 5,
    leaseMs: 500,
    sendTimeoutMs: 100,
    retryBaseDelayMs: 1000,
    now: () => NOW,
  });
  const result = await processor.processOne({
    signal: new AbortController().signal,
  });
  assert.equal(result, 'sent');
  assert.equal(sentWhileTransaction, false);
  assert.equal(transactionCalls, 3);
});

test('tenant lockがあるrepositoryでは接続検証から送信・確定までlock内で実行する', async () => {
  const repository = repositoryFor();
  const sequence: string[] = [];
  repository.withTenantLock = async (_tenantId, work) => {
    sequence.push('lock');
    const result = await work();
    sequence.push('unlock');
    return result;
  };
  repository.validateClaim = async () => {
    sequence.push('validate');
    return true;
  };
  repository.markSent = async (input) => {
    sequence.push('mark-sent');
    repository.sent.push(input);
    return 'sent';
  };
  const processor = createLineDeliveryProcessor({
    repository,
    transport: {
      send: async () => {
        sequence.push('send');
        return { providerMessageId: 'provider-request-id' };
      },
    },
    maxAttempts: 5,
    leaseMs: 500,
    sendTimeoutMs: 100,
    retryBaseDelayMs: 1000,
  });
  assert.equal(
    await processor.processOne({ signal: new AbortController().signal }),
    'sent',
  );
  assert.deepEqual(sequence, [
    'lock',
    'validate',
    'send',
    'mark-sent',
    'unlock',
  ]);
});

test('group lockがあるrepositoryではtenant lockより優先してgroup再利用を直列化する', async () => {
  const repository = repositoryFor();
  const sequence: string[] = [];
  repository.withTenantLock = async () => {
    throw new Error('group lock must be preferred');
  };
  repository.withDeliveryLock = async (_tenantId, destination, work) => {
    sequence.push(`lock:${destination}`);
    const result = await work();
    sequence.push('unlock');
    return result;
  };
  repository.validateClaim = async () => {
    sequence.push('validate');
    return true;
  };
  repository.markSent = async (input) => {
    sequence.push('mark-sent');
    repository.sent.push(input);
    return 'sent';
  };
  const processor = createLineDeliveryProcessor({
    repository,
    transport: {
      send: async () => {
        sequence.push('send');
        return { providerMessageId: 'provider-request-id' };
      },
    },
    maxAttempts: 5,
    leaseMs: 500,
    sendTimeoutMs: 100,
    retryBaseDelayMs: 1000,
  });
  assert.equal(
    await processor.processOne({ signal: new AbortController().signal }),
    'sent',
  );
  assert.deepEqual(sequence, [
    'lock:line-group',
    'validate',
    'send',
    'mark-sent',
    'unlock',
  ]);
});

test('接続世代の再検証失敗は外部LINE送信前にstaleへ収束する', async () => {
  const repository = repositoryFor();
  repository.validateClaim = async () => false;
  let sendCount = 0;
  const processor = createLineDeliveryProcessor({
    repository,
    transport: {
      send: async () => {
        sendCount += 1;
        return { providerMessageId: 'must-not-send' };
      },
    },
    maxAttempts: 5,
    leaseMs: 500,
    sendTimeoutMs: 100,
    retryBaseDelayMs: 1000,
  });
  assert.equal(
    await processor.processOne({ signal: new AbortController().signal }),
    'stale',
  );
  assert.equal(sendCount, 0);
  assert.deepEqual(repository.sent, []);
});

test('timeoutはAbortSignalを実際にabortし、lease期限以降の再試行状態を保存する', async () => {
  const repository = repositoryFor();
  let observedSignal: AbortSignal | undefined;
  const processor = createLineDeliveryProcessor({
    repository,
    transport: {
      send: async ({ signal }) => {
        observedSignal = signal;
        await new Promise<void>(() => undefined);
        return { providerMessageId: 'never' };
      },
    },
    maxAttempts: 5,
    leaseMs: 500,
    sendTimeoutMs: 10,
    retryBaseDelayMs: 1,
    now: () => NOW,
  });
  const result = await processor.processOne({
    signal: new AbortController().signal,
  });
  assert.equal(result, 'unknown');
  assert.equal(observedSignal?.aborted, true);
  assert.equal(repository.failed.length, 1);
  assert.deepEqual(repository.failed[0], {
    tenantId: claim().tenantId,
    notificationId: claim().notificationId,
    attemptToken: claim().attemptToken,
    errorCode: 'timeout',
  });
});

test('親schedulerのAbortSignal中断はaborted状態として再試行へ確定する', async () => {
  const repository = repositoryFor();
  const controller = new AbortController();
  controller.abort();
  const processor = createLineDeliveryProcessor({
    repository,
    transport: {
      send: async () => ({ providerMessageId: 'must-not-send' }),
    },
    maxAttempts: 5,
    leaseMs: 500,
    sendTimeoutMs: 100,
    retryBaseDelayMs: 1000,
    now: () => NOW,
  });
  const result = await processor.processOne({ signal: controller.signal });
  assert.equal(result, 'unknown');
  assert.equal(
    (repository.failed[0] as { errorCode: string }).errorCode,
    'aborted',
  );
});

test('古いattempt tokenの確定はstaleとして無視し、別workerの状態を上書きしない', async () => {
  const repository = repositoryFor();
  repository.markSent = async () => 'stale';
  const processor = createLineDeliveryProcessor({
    repository,
    transport: {
      send: async () => ({ providerMessageId: 'provider-request-id' }),
    },
    maxAttempts: 5,
    leaseMs: 500,
    sendTimeoutMs: 100,
    retryBaseDelayMs: 1000,
    now: () => NOW,
  });
  assert.equal(
    await processor.processOne({ signal: new AbortController().signal }),
    'stale',
  );
  assert.equal(repository.failed.length, 0);
});

test('通知失敗は個人情報を結果へ出さず、再試行状態へ確定する', async () => {
  const repository = repositoryFor();
  const processor = createLineDeliveryProcessor({
    repository,
    transport: {
      send: async () => {
        throw new Error('private name and LINE response must not escape');
      },
    },
    maxAttempts: 5,
    leaseMs: 500,
    sendTimeoutMs: 100,
    retryBaseDelayMs: 1000,
    now: () => NOW,
  });
  const result = await processor.processOne({
    signal: new AbortController().signal,
  });
  assert.equal(result, 'failed');
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(
    (repository.failed[0] as { errorCode: string }).errorCode,
    'provider_failure',
  );
});

test('provider ID欠落は外部副作用不明としてunknownへ遷移する', async () => {
  const repository = repositoryFor();
  const processor = createLineDeliveryProcessor({
    repository,
    transport: {
      send: async () => {
        const error = new Error('provider response has no identity');
        error.name = 'LineDeliveryProviderIdError';
        throw error;
      },
    },
    maxAttempts: 5,
    leaseMs: 500,
    sendTimeoutMs: 100,
    retryBaseDelayMs: 1000,
    now: () => NOW,
  });
  assert.equal(
    await processor.processOne({ signal: new AbortController().signal }),
    'unknown',
  );
  assert.equal(
    (repository.failed[0] as { errorCode: string }).errorCode,
    'provider_id_missing',
  );
});

test('LINE送信は正式なX-Line-Retry-Keyだけをproviderへ渡す', async () => {
  const originalFetch = globalThis.fetch;
  let requestHeaders: Headers | undefined;
  globalThis.fetch = async (_input, init) => {
    requestHeaders = new Headers(init?.headers);
    return new Response(null, {
      status: 200,
      headers: { 'x-line-request-id': 'provider-request-id' },
    });
  };
  try {
    const retryKey = claim().providerRetryKey;
    const result = await createLineMessagingTransport(
      'channel-access-token',
    ).send({
      notification: claim(),
      idempotencyKey: claim().idempotencyKey,
      retryKey,
      signal: new AbortController().signal,
    });
    assert.deepEqual(result, { providerMessageId: 'provider-request-id' });
    assert.equal(requestHeaders?.get('x-line-retry-key'), retryKey);
    assert.equal(requestHeaders?.has('x-idempotency-key'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('LINE 409応答はprovider_failureとして再試行状態へ確定する', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 409 });
  try {
    const repository = repositoryFor();
    const processor = createLineDeliveryProcessor({
      repository,
      transport: createLineMessagingTransport('channel-access-token'),
      maxAttempts: 5,
      leaseMs: 500,
      sendTimeoutMs: 100,
      retryBaseDelayMs: 1000,
    });
    assert.equal(
      await processor.processOne({ signal: new AbortController().signal }),
      'failed',
    );
    assert.equal(
      (repository.failed[0] as { errorCode: string }).errorCode,
      'provider_failure',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('migrationはtenant・認可・監査・冪等性の境界をDB側で保証する', () => {
  assert.match(MIGRATION, /UNIQUE \(tenant_id, source_type, source_id\)/);
  assert.match(
    MIGRATION,
    /p_tenant_id <> NULLIF\(current_setting\('app\.tenant_id'/,
  );
  assert.match(MIGRATION, /current_setting\('app\.user_id', true\)/);
  assert.match(
    MIGRATION,
    /current_setting\('app\.role', true\).*owner.*admin/s,
  );
  assert.match(
    MIGRATION,
    /ALTER TABLE line_delivery_outbox FORCE ROW LEVEL SECURITY/,
  );
  assert.match(MIGRATION, /attempt_token = p_attempt_token/);
  assert.match(MIGRATION, /INSERT INTO audit_logs/);
  assert.match(MIGRATION, /error_code/);
  assert.doesNotMatch(MIGRATION, /jsonb_build_object\([^)]*body/s);
});

test('security hardening migrationはDB時刻・unknown・専用worker権限を固定する', () => {
  assert.match(HARDENING_MIGRATION, /FOR UPDATE/);
  assert.match(HARDENING_MIGRATION, /clock_timestamp\(\)/);
  assert.match(HARDENING_MIGRATION, /gen_random_uuid\(\)/);
  assert.match(
    HARDENING_MIGRATION,
    /status IN \('pending', 'sending', 'sent', 'failed', 'unknown'\)/,
  );
  assert.match(
    HARDENING_MIGRATION,
    /GRANT EXECUTE ON FUNCTION app_claim.*TO line_delivery_worker/s,
  );
  assert.match(
    HARDENING_MIGRATION,
    /REVOKE ALL ON TABLE line_delivery_outbox FROM cocolo_app/,
  );
  assert.doesNotMatch(
    HARDENING_MIGRATION,
    /GRANT EXECUTE ON FUNCTION app_claim.*TO cocolo_app/s,
  );
  assert.match(HARDENING_MIGRATION, /payload_hash/);
  assert.match(HARDENING_MIGRATION, /idempotency_key/);
});

test('provider retry key migrationはpayload冪等性と同じoutbox行へ固定する', () => {
  assert.match(PROVIDER_RETRY_MIGRATION, /provider_retry_key uuid/);
  assert.match(PROVIDER_RETRY_MIGRATION, /X-Line-Retry-Key/);
  assert.match(PROVIDER_RETRY_MIGRATION, /provider_retry_key\s*\)\s*VALUES/);
  assert.match(
    PROVIDER_RETRY_MIGRATION,
    /provider_retry_key, updated\.payload_hash/,
  );
  assert.match(PROVIDER_RETRY_MIGRATION, /status IN \('pending', 'failed'\)/);
});

test('予定LINE通知migrationは対象予定・接続先・状態遷移をDB側で固定する', () => {
  assert.match(
    EVENT_LINE_DELIVERY_MIGRATION,
    /p_source_id !~\* '\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-7/,
  );
  assert.match(
    EVENT_LINE_DELIVERY_MIGRATION,
    /p_idempotency_key <> p_source_type \|\| ':' \|\| normalized_source_id/,
  );
  assert.match(
    EVENT_LINE_DELIVERY_MIGRATION,
    /normalized_source_id := p_source_id::uuid::text/,
  );
  assert.match(
    EVENT_LINE_DELIVERY_MIGRATION,
    /pg_advisory_xact_lock\([\s\S]*p_tenant_id::text \|\| ':' \|\| p_actor_user_id/s,
  );
  assert.match(
    EVENT_LINE_DELIVERY_MIGRATION,
    /FROM events[\s\S]*tenant_id = p_tenant_id[\s\S]*id = normalized_source_id::uuid/,
  );
  assert.match(
    EVENT_LINE_DELIVERY_MIGRATION,
    /FROM line_connections[\s\S]*tenant_id = p_tenant_id[\s\S]*group_id = p_destination[\s\S]*FOR KEY SHARE/,
  );
  assert.match(
    EVENT_LINE_DELIVERY_MIGRATION,
    /status IN \('pending', 'failed'\)/,
  );
  assert.match(
    EVENT_LINE_DELIVERY_MIGRATION,
    /status = CASE[\s\S]*ELSE line_delivery_outbox\.status/s,
  );
  assert.match(
    EVENT_LINE_DELIVERY_MIGRATION,
    /REVOKE ALL ON FUNCTION app_enqueue_event_line_delivery[\s\S]*GRANT EXECUTE[\s\S]*TO cocolo_app/s,
  );
  assert.match(
    EVENT_LINE_DELIVERY_MIGRATION,
    /connection_connected_at timestamptz/,
  );
});

test('LINE通知claimは現行接続世代と一致するoutboxだけを送信対象にする', () => {
  assert.match(
    CONNECTION_GENERATION_MIGRATION,
    /(?:FROM|JOIN) line_connections c[\s\S]*c\.status = 'connected'/,
  );
  assert.match(
    CONNECTION_GENERATION_MIGRATION,
    /c\.connected_at = o\.connection_connected_at/,
  );
  assert.match(
    CONNECTION_GENERATION_MIGRATION,
    /c\.connected_at <= o\.created_at/,
  );
  assert.match(
    CONNECTION_GENERATION_MIGRATION,
    /o\.source_type NOT IN \('event', 'deadline'\)/,
  );
  assert.match(CONNECTION_GENERATION_MIGRATION, /FOR UPDATE OF o SKIP LOCKED/);
  assert.match(
    CONNECTION_GENERATION_MIGRATION,
    /pg_advisory_xact_lock\([\s\S]*'line:' \|\| candidate_tenant_id::text/s,
  );
  assert.match(
    CONNECTION_GENERATION_MIGRATION,
    /CREATE FUNCTION app_validate_line_delivery_claim[\s\S]*status = 'unknown'[\s\S]*connection_changed/s,
  );
  assert.doesNotMatch(
    CONNECTION_GENERATION_MIGRATION,
    /GRANT EXECUTE ON FUNCTION app_claim_line_delivery_outbox\(integer, integer\) TO cocolo_app/,
  );
});

test('公開LINE通知は現在の接続groupと接続世代をoutboxへ固定する', () => {
  assert.match(CONNECTION_GUARD_MIGRATION, /session_user <> 'cocolo_app'/);
  assert.match(
    CONNECTION_GUARD_MIGRATION,
    /FROM line_connections[\s\S]*tenant_id = p_tenant_id[\s\S]*group_id = p_destination[\s\S]*status = 'connected'/,
  );
  assert.match(
    CONNECTION_GUARD_MIGRATION,
    /接続済みのLINEグループ以外へ通知できません/,
  );
  assert.match(
    CONNECTION_GUARD_MIGRATION,
    /connection_connected_at\s*\n\s*\) VALUES[\s\S]*calculated_hash, connection_connected_at/s,
  );
  assert.match(
    CONNECTION_GUARD_MIGRATION,
    /pg_advisory_xact_lock\([\s\S]*'line:' \|\| p_tenant_id::text/s,
  );
});

test('汎用LINE通知は別tenantによるgroup再利用時にclaim・送信前検証から除外する', () => {
  assert.match(
    GROUP_REUSE_MIGRATION,
    /CREATE OR REPLACE FUNCTION app_claim_line_delivery_outbox/,
  );
  assert.match(
    GROUP_REUSE_MIGRATION,
    /o\.source_type NOT IN \('event', 'deadline'\)[\s\S]*c\.tenant_id <> o\.tenant_id/s,
  );
  assert.match(
    GROUP_REUSE_MIGRATION,
    /CREATE OR REPLACE FUNCTION app_validate_line_delivery_claim/,
  );
  assert.match(
    GROUP_REUSE_MIGRATION,
    /status = 'unknown'[\s\S]*connection_changed/s,
  );
});

test('LINE送信中のadvisory lock transactionは外部送信timeoutより長く保持する', () => {
  assert.match(
    SCHEDULER_SOURCE,
    /const LINE_DELIVERY_TRANSACTION_TIMEOUT_MS = MAX_SEND_TIMEOUT_MS \+ 10_000/,
  );
  assert.match(
    SCHEDULER_SOURCE,
    /withDeliveryLock:[\s\S]*client\.\$transaction[\s\S]*timeout: LINE_DELIVERY_TRANSACTION_TIMEOUT_MS/s,
  );
});

test('unknown確定migrationはtokenと有効leaseを同じUPDATE条件で検証する', () => {
  assert.match(UNKNOWN_LEASE_MIGRATION, /status = 'sending'/);
  assert.match(UNKNOWN_LEASE_MIGRATION, /attempt_token = p_attempt_token/);
  assert.match(
    UNKNOWN_LEASE_MIGRATION,
    /lease_expires_at > clock_timestamp\(\)/,
  );
  assert.match(UNKNOWN_LEASE_MIGRATION, /RETURN QUERY SELECT 'stale'/);
});

test('schedulerの実行失敗は指数backoffだけを返し、例外本文を返さない', async () => {
  const result = await runLineDeliveryScheduler({
    config: config({ attempt: 2, retryBaseDelayMs: 5000 }),
    worker: {
      run: async () => {
        throw new Error('token and PII must not be returned');
      },
    },
    processor: { processOne: async () => 'idle' },
    now: () => NOW,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.retryAfterMs, 10000);
  assert.equal(JSON.stringify(result).includes('token'), false);
});

test('workerの通知単位failedはschedulerの実行成功として扱う', async () => {
  const result = await runLineDeliveryScheduler({
    config: config(),
    worker: { run: async () => 'failed' },
    processor: { processOne: async () => 'failed' },
    now: () => NOW,
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.workerStatus, 'failed');
  assert.equal(result.retryable, false);
});

test('scheduler試行回数上限に達した失敗は自動再試行しない', async () => {
  const result = await runLineDeliveryScheduler({
    config: config({ attempt: 3, maxAttempts: 3 }),
    worker: {
      run: async () => {
        throw new Error('transient failure');
      },
    },
    processor: { processOne: async () => 'idle' },
    now: () => NOW,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.retryable, false);
  assert.equal(result.retryAfterMs, null);
  assert.equal(result.retryAt, null);
});
