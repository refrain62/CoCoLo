import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPostgresLineDeliveryLock,
  type LineDeliveryLockDatabase,
  type LineDeliverySchedulerConfig,
  readLineDeliverySchedulerConfig,
  runLineDeliveryScheduler,
} from '../dist/line-delivery-scheduler.js';

const NOW = new Date('2026-08-23T00:00:00.000Z');

function environment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    APP_ENV: 'staging',
    DATABASE_URL: 'postgresql://app:secret@localhost:5432/cocolo',
    LINE_CHANNEL_ACCESS_TOKEN: 'channel-access-token',
    LINE_DELIVERY_TRANSPORT: 'real',
    LINE_DELIVERY_WORKER_MODULE: './line-delivery-worker.js',
    LINE_DELIVERY_BATCH_SIZE: '4',
    LINE_DELIVERY_LOCK_KEY: 'periodic',
    LINE_DELIVERY_SCHEDULER_MAX_ATTEMPTS: '3',
    LINE_DELIVERY_SCHEDULER_ATTEMPT: '1',
    LINE_DELIVERY_RETRY_BASE_DELAY_SECONDS: '2',
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
    lockKey: 'cocolo:line-delivery:staging:periodic',
    attempt: 1,
    maxAttempts: 3,
    retryBaseDelayMs: 2000,
    ...overrides,
  };
}

function immediateLock() {
  return {
    withLock: async <T>(_input: { key: string }, work: () => Promise<T>) => ({
      acquired: true as const,
      value: await work(),
    }),
  };
}

test('schedulerの必須環境値を検証し、localと不正な件数を拒否する', () => {
  assert.throws(
    () => readLineDeliverySchedulerConfig(environment({ APP_ENV: 'local' })),
    /staging \/ production/,
  );
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
  assert.equal(parsed.lockKey, 'cocolo:line-delivery:staging:periodic');
  assert.equal(parsed.retryBaseDelayMs, 2000);
});

test('schedulerはlock取得後にworkerへ最大処理件数を渡す', async () => {
  let received: { maxItems: number; signal: AbortSignal } | undefined;
  const result = await runLineDeliveryScheduler({
    config: config({ maxItems: 7 }),
    lock: immediateLock(),
    worker: {
      run: async (input) => {
        received = input;
        return 'sent';
      },
    },
    now: () => NOW,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.workerStatus, 'sent');
  assert.equal(result.maxItems, 7);
  assert.equal(received?.maxItems, 7);
  assert.ok(received?.signal);
});

test('lock競合時はworkerを起動せず、外部schedulerの再試行対象にしない', async () => {
  let workerCalls = 0;
  const result = await runLineDeliveryScheduler({
    config: config(),
    lock: {
      withLock: async () => ({ acquired: false as const }),
    },
    worker: {
      run: async () => {
        workerCalls += 1;
        return 'sent';
      },
    },
    now: () => NOW,
  });

  assert.equal(result.status, 'locked');
  assert.equal(result.retryable, false);
  assert.equal(workerCalls, 0);
});

test('同時起動はlockで一つだけworkerを実行する', async () => {
  let held = false;
  let releaseWorker: (() => void) | undefined;
  let workerStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    workerStarted = resolve;
  });
  const lock = {
    withLock: async <T>(_input: { key: string }, work: () => Promise<T>) => {
      if (held) return { acquired: false as const };
      held = true;
      try {
        return { acquired: true as const, value: await work() };
      } finally {
        held = false;
      }
    },
  };
  const worker = {
    run: async () => {
      workerStarted?.();
      await new Promise<void>((resolve) => {
        releaseWorker = resolve;
      });
      return 'sent' as const;
    },
  };

  const first = runLineDeliveryScheduler({
    config: config(),
    lock,
    worker,
    now: () => NOW,
  });
  await started;
  const second = await runLineDeliveryScheduler({
    config: config(),
    lock,
    worker,
    now: () => NOW,
  });
  assert.equal(second.status, 'locked');

  releaseWorker?.();
  const firstResult = await first;
  assert.equal(firstResult.status, 'completed');
});

test('worker例外は即時再試行せず、指数バックオフ契約を返す', async () => {
  const result = await runLineDeliveryScheduler({
    config: config({ attempt: 2, retryBaseDelayMs: 5000 }),
    lock: immediateLock(),
    worker: {
      run: async () => {
        throw new Error('access token should not be returned');
      },
    },
    now: () => NOW,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.retryable, true);
  assert.equal(result.retryAfterMs, 10000);
  assert.equal(result.retryAt, '2026-08-23T00:00:10.000Z');
  assert.equal('error' in result, false);
});

test('scheduler試行回数上限に達した失敗は自動再試行しない', async () => {
  const result = await runLineDeliveryScheduler({
    config: config({ attempt: 3, maxAttempts: 3 }),
    lock: immediateLock(),
    worker: {
      run: async () => {
        throw new Error('transient failure');
      },
    },
    now: () => NOW,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.retryable, false);
  assert.equal(result.retryAfterMs, null);
  assert.equal(result.retryAt, null);
});

test('workerが通知単位の失敗を記録した場合はscheduler実行成功として扱う', async () => {
  const result = await runLineDeliveryScheduler({
    config: config(),
    lock: immediateLock(),
    worker: { run: async () => 'failed' },
    now: () => NOW,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.workerStatus, 'failed');
  assert.equal(result.retryable, false);
});

test('PostgreSQL advisory lockは取得できたtransactionの範囲でworkerを実行する', async () => {
  const queries: Array<{ values: readonly unknown[] }> = [];
  let transactionCalls = 0;
  const database: LineDeliveryLockDatabase = {
    transaction: async (work) => {
      transactionCalls += 1;
      return work({
        queryRaw: async <Row>(
          _strings: TemplateStringsArray,
          ...values: unknown[]
        ) => {
          queries.push({ values });
          return [{ acquired: true }] as Row;
        },
      });
    },
  };
  const lock = createPostgresLineDeliveryLock(database);
  let workerCalls = 0;
  const result = await lock.withLock(
    { key: 'cocolo:line-delivery:test' },
    async () => {
      workerCalls += 1;
      return 'done';
    },
  );

  assert.deepEqual(result, { acquired: true, value: 'done' });
  assert.equal(transactionCalls, 1);
  assert.equal(workerCalls, 1);
  assert.deepEqual(queries[0]?.values, ['cocolo:line-delivery:test']);
});
