import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPrismaClient } from '@cocolo/db';

type SchedulerEnvironmentInput = Record<string, string | undefined>;

type LineDeliveryAppEnvironment = 'staging' | 'production';

export type LineDeliveryWorkerStatus = 'idle' | 'sent' | 'failed';

export type LineDeliveryWorker = {
  run: (input: {
    maxItems: number;
    signal: AbortSignal;
  }) => Promise<LineDeliveryWorkerStatus>;
};

export type LineDeliverySchedulerConfig = {
  appEnv: LineDeliveryAppEnvironment;
  transport: 'real';
  workerModule: string;
  maxItems: number;
  lockKey: string;
  attempt: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
};

type LineDeliveryLockResult<T> =
  | { acquired: true; value: T }
  | { acquired: false };

export type LineDeliveryRunLock = {
  withLock: <T>(
    input: { key: string },
    work: () => Promise<T>,
  ) => Promise<LineDeliveryLockResult<T>>;
};

export type LineDeliverySchedulerResult = {
  status: 'completed' | 'locked' | 'failed';
  workerStatus: LineDeliveryWorkerStatus | null;
  maxItems: number;
  attempt: number;
  maxAttempts: number;
  retryable: boolean;
  retryAfterMs: number | null;
  retryAt: string | null;
};

export type LineDeliveryLockTransaction = {
  queryRaw: <Row>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<Row>;
};

export type LineDeliveryLockDatabase = {
  transaction: <T>(
    work: (transaction: LineDeliveryLockTransaction) => Promise<T>,
  ) => Promise<T>;
};

const MAX_BATCH_SIZE = 100;
const MAX_SCHEDULER_ATTEMPTS = 5;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;
const LOCK_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function required(
  environment: SchedulerEnvironmentInput,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} が必要です。`);
  return value;
}

function boundedInteger(
  environment: SchedulerEnvironmentInput,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const value = Number(required(environment, name));
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(`${name} が不正です。`);
  return value;
}

function assertSafeWorkerModulePath(modulePath: string): void {
  if (
    !modulePath.startsWith('./') ||
    modulePath.includes('\\') ||
    modulePath.includes('\0') ||
    modulePath.includes('../') ||
    !modulePath.endsWith('.js')
  )
    throw new Error('LINE_DELIVERY_WORKER_MODULE が不正です。');
}

// 実送信schedulerはlocalから起動できないようにし、環境値不足をworker実行前に拒否する。
export function readLineDeliverySchedulerConfig(
  environment: SchedulerEnvironmentInput,
): LineDeliverySchedulerConfig {
  const appEnv = environment.APP_ENV?.trim();
  if (appEnv !== 'staging' && appEnv !== 'production')
    throw new Error(
      'LINE配信schedulerはstaging / productionでだけ実行できます。',
    );

  required(environment, 'DATABASE_URL');
  required(environment, 'LINE_CHANNEL_ACCESS_TOKEN');
  const transport = required(environment, 'LINE_DELIVERY_TRANSPORT');
  if (transport !== 'real')
    throw new Error('LINE_DELIVERY_TRANSPORT は real が必要です。');

  const workerModule = required(environment, 'LINE_DELIVERY_WORKER_MODULE');
  assertSafeWorkerModulePath(workerModule);

  const maxItems = boundedInteger(
    environment,
    'LINE_DELIVERY_BATCH_SIZE',
    1,
    MAX_BATCH_SIZE,
  );
  const lockKey = required(environment, 'LINE_DELIVERY_LOCK_KEY');
  if (!LOCK_KEY_PATTERN.test(lockKey))
    throw new Error('LINE_DELIVERY_LOCK_KEY が不正です。');

  const maxAttempts = boundedInteger(
    environment,
    'LINE_DELIVERY_SCHEDULER_MAX_ATTEMPTS',
    1,
    MAX_SCHEDULER_ATTEMPTS,
  );
  const attempt = boundedInteger(
    environment,
    'LINE_DELIVERY_SCHEDULER_ATTEMPT',
    1,
    maxAttempts,
  );
  const retryBaseDelaySeconds = boundedInteger(
    environment,
    'LINE_DELIVERY_RETRY_BASE_DELAY_SECONDS',
    1,
    60 * 60,
  );

  return {
    appEnv,
    transport: 'real',
    workerModule,
    maxItems,
    lockKey: `cocolo:line-delivery:${appEnv}:${lockKey}`,
    attempt,
    maxAttempts,
    retryBaseDelayMs: retryBaseDelaySeconds * 1000,
  };
}

function retryDelayMs(config: LineDeliverySchedulerConfig): number {
  return Math.min(
    config.retryBaseDelayMs * 2 ** (config.attempt - 1),
    MAX_RETRY_DELAY_MS,
  );
}

function failedResult(
  config: LineDeliverySchedulerConfig,
  now: Date,
): LineDeliverySchedulerResult {
  const retryable = config.attempt < config.maxAttempts;
  const retryAfter = retryable ? retryDelayMs(config) : null;
  return {
    status: 'failed',
    workerStatus: null,
    maxItems: config.maxItems,
    attempt: config.attempt,
    maxAttempts: config.maxAttempts,
    retryable,
    retryAfterMs: retryAfter,
    retryAt:
      retryAfter === null
        ? null
        : new Date(now.getTime() + retryAfter).toISOString(),
  };
}

// 一回のscheduler実行は一つのlock内で最大件数だけworkerへ委譲し、失敗時は外部schedulerへ再実行判断を返す。
export async function runLineDeliveryScheduler(input: {
  config: LineDeliverySchedulerConfig;
  lock: LineDeliveryRunLock;
  worker: LineDeliveryWorker;
  now?: () => Date;
  signal?: AbortSignal;
}): Promise<LineDeliverySchedulerResult> {
  const now = input.now ?? (() => new Date());
  const signal = input.signal ?? new AbortController().signal;

  try {
    if (signal.aborted) throw new Error('schedulerが中断されました。');
    const locked = await input.lock.withLock(
      { key: input.config.lockKey },
      async () => {
        if (signal.aborted) throw new Error('schedulerが中断されました。');
        const workerStatus = await input.worker.run({
          maxItems: input.config.maxItems,
          signal,
        });
        if (
          workerStatus !== 'idle' &&
          workerStatus !== 'sent' &&
          workerStatus !== 'failed'
        )
          throw new Error('workerの結果が不正です。');
        return workerStatus;
      },
    );

    if (!locked.acquired)
      return {
        status: 'locked',
        workerStatus: null,
        maxItems: input.config.maxItems,
        attempt: input.config.attempt,
        maxAttempts: input.config.maxAttempts,
        retryable: false,
        retryAfterMs: null,
        retryAt: null,
      };

    return {
      status: 'completed',
      workerStatus: locked.value,
      maxItems: input.config.maxItems,
      attempt: input.config.attempt,
      maxAttempts: input.config.maxAttempts,
      retryable: false,
      retryAfterMs: null,
      retryAt: null,
    };
  } catch {
    return failedResult(input.config, now());
  }
}

// advisory lockはtransaction終了時に自動解放されるため、プロセス停止後に孤児ロックを残さない。
export function createPostgresLineDeliveryLock(
  database: LineDeliveryLockDatabase,
): LineDeliveryRunLock {
  return {
    withLock: async ({ key }, work) =>
      database.transaction(async (transaction) => {
        const rows = await transaction.queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS acquired
        `;
        if (rows.length !== 1 || typeof rows[0]?.acquired !== 'boolean')
          throw new Error('scheduler lockの応答が不正です。');
        if (!rows[0].acquired) return { acquired: false as const };
        return { acquired: true as const, value: await work() };
      }),
  };
}

type WorkerModule = {
  runLineDeliveryWorker?: (input: {
    maxItems: number;
    signal: AbortSignal;
  }) => Promise<unknown>;
};

function toWorkerStatus(value: unknown): LineDeliveryWorkerStatus {
  if (value === 'idle' || value === 'sent' || value === 'failed') return value;
  throw new Error('LINE delivery workerの結果が不正です。');
}

// 既存workerのLINE_DELIVERY_BATCH_SIZE契約を使い、scheduler側から実行件数を上書きしない。
export async function loadLineDeliveryWorker(
  modulePath: string,
  baseDirectory = fileURLToPath(new URL('.', import.meta.url)),
): Promise<LineDeliveryWorker> {
  assertSafeWorkerModulePath(modulePath);
  const basePath = resolve(baseDirectory);
  const resolvedPath = resolve(basePath, modulePath);
  const relativePath = relative(basePath, resolvedPath);
  if (
    isAbsolute(modulePath) ||
    relativePath.startsWith('..') ||
    isAbsolute(relativePath)
  )
    throw new Error('LINE_DELIVERY_WORKER_MODULE の配置が不正です。');

  const module = (await import(
    pathToFileURL(resolvedPath).href
  )) as WorkerModule;
  if (typeof module.runLineDeliveryWorker !== 'function')
    throw new Error('LINE_DELIVERY_WORKER_MODULE にworker入口がありません。');
  const runLineDeliveryWorker = module.runLineDeliveryWorker;

  return {
    async run(input) {
      return toWorkerStatus(await runLineDeliveryWorker(input));
    },
  };
}

function createPrismaLockDatabase(
  client: ReturnType<typeof createPrismaClient>,
): LineDeliveryLockDatabase {
  return {
    transaction: (work) =>
      client.$transaction(async (transaction) =>
        work({
          queryRaw: <Row>(
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => transaction.$queryRaw<Row>(strings, ...values),
        }),
      ),
  };
}

// 外部schedulerの実行入口。設定不備は2、worker/DB失敗は1、ロック競合と正常終了は0で終了する。
export async function runLineDeliverySchedulerEntry(
  environment: SchedulerEnvironmentInput = process.env,
): Promise<number> {
  let client: ReturnType<typeof createPrismaClient> | null = null;
  try {
    const config = readLineDeliverySchedulerConfig(environment);
    const worker = await loadLineDeliveryWorker(config.workerModule);
    client = createPrismaClient();
    const result = await runLineDeliveryScheduler({
      config,
      lock: createPostgresLineDeliveryLock(createPrismaLockDatabase(client)),
      worker,
    });
    console.log(JSON.stringify(result));
    return result.status === 'failed' ? 1 : 0;
  } catch {
    console.error('LINE配信schedulerの設定または実行に失敗しました。');
    return 2;
  } finally {
    if (client) await client.$disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly)
  runLineDeliverySchedulerEntry().then((exitCode) => {
    process.exitCode = exitCode;
  });
