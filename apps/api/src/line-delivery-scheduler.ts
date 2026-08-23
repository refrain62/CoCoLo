import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPrismaClient } from '@cocolo/db';

type SchedulerEnvironmentInput = Record<string, string | undefined>;
type LineDeliveryAppEnvironment = 'staging' | 'production';

export type LineDeliveryWorkerStatus = 'idle' | 'sent' | 'failed' | 'unknown';
export type LineDeliveryItemStatus = LineDeliveryWorkerStatus | 'stale';

export type LineDeliverySchedulerConfig = {
  appEnv: LineDeliveryAppEnvironment;
  transport: 'real';
  workerModule: string;
  maxItems: number;
  attempt: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  notificationMaxAttempts: number;
  sendTimeoutMs: number;
  leaseMs: number;
  database: { host: string; name: string; role: string };
};

export type LineDeliveryClaim = {
  notificationId: string;
  tenantId: string;
  destination: string;
  title: string;
  body: string;
  deepLink: string;
  idempotencyKey: string;
  providerRetryKey: string;
  payloadHash: string;
  attempt: number;
  attemptToken: string;
  leaseExpiresAt: Date;
};

export type LineDeliveryClaimRepository = {
  claimDue: (input: {
    maxAttempts: number;
    leaseMs: number;
    signal: AbortSignal;
  }) => Promise<LineDeliveryClaim | null>;
  markSent: (input: {
    tenantId: string;
    notificationId: string;
    attemptToken: string;
    providerMessageId: string;
  }) => Promise<'sent' | 'stale'>;
  markFailed: (input: {
    tenantId: string;
    notificationId: string;
    attemptToken: string;
    errorCode: 'provider_failure';
    retryDelayMs: number;
  }) => Promise<'failed' | 'stale'>;
  markUnknown: (input: {
    tenantId: string;
    notificationId: string;
    attemptToken: string;
    errorCode: 'aborted' | 'timeout' | 'provider_id_missing';
  }) => Promise<'unknown' | 'stale'>;
};

export type LineDeliveryTransport = {
  send: (input: {
    notification: Pick<
      LineDeliveryClaim,
      'notificationId' | 'destination' | 'title' | 'body' | 'deepLink'
    >;
    idempotencyKey: string;
    retryKey: string;
    signal: AbortSignal;
  }) => Promise<{ providerMessageId: string }>;
};

export type LineDeliveryProcessor = {
  processOne: (input: {
    signal: AbortSignal;
  }) => Promise<LineDeliveryItemStatus>;
};

export type LineDeliveryWorker = {
  run: (input: {
    maxItems: number;
    signal: AbortSignal;
    processOne: LineDeliveryProcessor['processOne'];
  }) => Promise<LineDeliveryWorkerStatus>;
};

export type LineDeliveryDatabase = {
  transaction: <T>(
    work: (transaction: {
      queryRaw: <Row>(
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<Row>;
    }) => Promise<T>,
  ) => Promise<T>;
};

const MAX_BATCH_SIZE = 100;
const MAX_SCHEDULER_ATTEMPTS = 5;
const MAX_NOTIFICATION_ATTEMPTS = 5;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;
const MAX_SEND_TIMEOUT_MS = 120_000;
const MAX_LEASE_MS = 10 * 60 * 1000;

type DatabaseAllowlist = Record<
  LineDeliveryAppEnvironment,
  { hosts: string[]; names: string[]; roles: string[] }
>;

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

function parseDatabaseUrl(value: string): {
  host: string;
  name: string;
  role: string;
} {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL が不正です。');
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:')
    throw new Error('DATABASE_URL のprotocolが不正です。');
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const role = decodeURIComponent(url.username);
  if (!url.hostname || !name || !role)
    throw new Error('DATABASE_URL の接続先が不正です。');
  return { host: url.hostname.toLowerCase(), name, role };
}

function parseDatabaseAllowlist(value: string): DatabaseAllowlist {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('LINE_DELIVERY_DB_ALLOWLIST が不正です。');
  }
  if (!parsed || typeof parsed !== 'object')
    throw new Error('LINE_DELIVERY_DB_ALLOWLIST が不正です。');
  const allowlist = {} as DatabaseAllowlist;
  for (const appEnv of ['staging', 'production'] as const) {
    const candidate = (parsed as Record<string, unknown>)[appEnv];
    if (!candidate || typeof candidate !== 'object')
      throw new Error('LINE_DELIVERY_DB_ALLOWLIST が不正です。');
    const record = candidate as Record<string, unknown>;
    const values = ['hosts', 'names', 'roles'].map((key) => record[key]);
    if (
      values.some(
        (items) =>
          !Array.isArray(items) ||
          items.length === 0 ||
          items.some((item) => typeof item !== 'string' || !item.trim()),
      )
    )
      throw new Error('LINE_DELIVERY_DB_ALLOWLIST が不正です。');
    allowlist[appEnv] = {
      hosts: (record.hosts as string[]).map((item) =>
        item.trim().toLowerCase(),
      ),
      names: (record.names as string[]).map((item) => item.trim()),
      roles: (record.roles as string[]).map((item) => item.trim()),
    };
  }
  const stagingPairs = new Set(
    allowlist.staging.hosts.flatMap((host) =>
      allowlist.staging.names.map((name) => `${host}\0${name}`),
    ),
  );
  const overlaps = allowlist.production.hosts.some((host) =>
    allowlist.production.names.some((name) =>
      stagingPairs.has(`${host}\0${name}`),
    ),
  );
  if (overlaps)
    throw new Error('stagingとproductionのDB許可値が重複しています。');
  return allowlist;
}

function assertDatabaseAllowed(
  database: { host: string; name: string; role: string },
  appEnv: LineDeliveryAppEnvironment,
  allowlist: DatabaseAllowlist,
): void {
  const allowed = allowlist[appEnv];
  if (
    !allowed.hosts.includes(database.host) ||
    !allowed.names.includes(database.name) ||
    !allowed.roles.includes(database.role)
  )
    throw new Error('DATABASE_URLがAPP_ENVのDB許可値と一致しません。');
}

// 実送信schedulerはAPP_ENVとDB host・DB名・roleを同時に照合し、環境混同を接続前に拒否する。
export function readLineDeliverySchedulerConfig(
  environment: SchedulerEnvironmentInput,
): LineDeliverySchedulerConfig {
  const appEnv = environment.APP_ENV?.trim();
  if (appEnv !== 'staging' && appEnv !== 'production')
    throw new Error(
      'LINE配信schedulerはstaging / productionでだけ実行できます。',
    );
  // API用DATABASE_URLを誤注入しないよう、worker専用接続URLを別名で必須にする。
  const database = parseDatabaseUrl(
    required(environment, 'LINE_DELIVERY_WORKER_DATABASE_URL'),
  );
  if (database.role !== 'line_delivery_worker')
    throw new Error('LINE配信schedulerは専用worker roleでのみ実行できます。');
  const allowlist = parseDatabaseAllowlist(
    required(environment, 'LINE_DELIVERY_DB_ALLOWLIST'),
  );
  assertDatabaseAllowed(database, appEnv, allowlist);
  required(environment, 'LINE_CHANNEL_ACCESS_TOKEN');
  if (required(environment, 'LINE_DELIVERY_TRANSPORT') !== 'real')
    throw new Error('LINE_DELIVERY_TRANSPORT は real が必要です。');
  const workerModule = required(environment, 'LINE_DELIVERY_WORKER_MODULE');
  assertSafeWorkerModulePath(workerModule);
  const maxItems = boundedInteger(
    environment,
    'LINE_DELIVERY_BATCH_SIZE',
    1,
    MAX_BATCH_SIZE,
  );
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
  const notificationMaxAttempts = boundedInteger(
    environment,
    'LINE_DELIVERY_NOTIFICATION_MAX_ATTEMPTS',
    1,
    MAX_NOTIFICATION_ATTEMPTS,
  );
  const sendTimeoutMs = boundedInteger(
    environment,
    'LINE_DELIVERY_SEND_TIMEOUT_MS',
    1,
    MAX_SEND_TIMEOUT_MS,
  );
  const leaseMs = boundedInteger(
    environment,
    'LINE_DELIVERY_LEASE_MS',
    sendTimeoutMs * 2,
    MAX_LEASE_MS,
  );
  return {
    appEnv,
    transport: 'real',
    workerModule,
    maxItems,
    attempt,
    maxAttempts,
    retryBaseDelayMs: retryBaseDelaySeconds * 1000,
    notificationMaxAttempts,
    sendTimeoutMs,
    leaseMs,
    database,
  };
}

function retryDelayMs(attempt: number, baseDelayMs: number): number {
  return Math.min(
    baseDelayMs * 2 ** Math.max(attempt - 1, 0),
    MAX_RETRY_DELAY_MS,
  );
}

export type LineDeliverySchedulerResult = {
  status: 'completed' | 'failed';
  workerStatus: LineDeliveryWorkerStatus | null;
  maxItems: number;
  attempt: number;
  maxAttempts: number;
  retryable: boolean;
  retryAfterMs: number | null;
  retryAt: string | null;
};

function failedResult(
  config: LineDeliverySchedulerConfig,
  now: Date,
): LineDeliverySchedulerResult {
  const retryable = config.attempt < config.maxAttempts;
  const retryAfter = retryable
    ? retryDelayMs(config.attempt, config.retryBaseDelayMs)
    : null;
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

// 旧実装のadvisory transaction lock検証は廃止した。lock保持中の送信継続を許すため、
// claim transactionの短時間確定とattempt token付きleaseを検証する契約へ置き換える。
// workerへclaim処理だけを渡し、scheduler自身が長時間transactionを保持しない。
export async function runLineDeliveryScheduler(input: {
  config: LineDeliverySchedulerConfig;
  worker: LineDeliveryWorker;
  processor: LineDeliveryProcessor;
  now?: () => Date;
  signal?: AbortSignal;
}): Promise<LineDeliverySchedulerResult> {
  const now = input.now ?? (() => new Date());
  const signal = input.signal ?? new AbortController().signal;
  try {
    if (signal.aborted) throw new Error('schedulerが中断されました。');
    const workerStatus = await input.worker.run({
      maxItems: input.config.maxItems,
      signal,
      processOne: input.processor.processOne,
    });
    if (
      workerStatus !== 'idle' &&
      workerStatus !== 'sent' &&
      workerStatus !== 'failed' &&
      workerStatus !== 'unknown'
    )
      throw new Error('workerの結果が不正です。');
    return {
      status: 'completed',
      workerStatus,
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

type ClaimRow = {
  notification_id: string;
  tenant_id: string;
  destination: string;
  title: string;
  body: string;
  deep_link: string;
  idempotency_key: string;
  provider_retry_key: string;
  payload_hash: string;
  attempt: number;
  attempt_token: string;
  lease_expires_at: Date;
};

function toClaim(row: ClaimRow | undefined): LineDeliveryClaim | null {
  if (!row) return null;
  if (
    !row.notification_id ||
    !row.tenant_id ||
    !row.destination ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-57][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      row.provider_retry_key,
    ) ||
    !row.attempt_token ||
    !(row.lease_expires_at instanceof Date)
  )
    throw new Error('LINE配信claimの応答が不正です。');
  return {
    notificationId: row.notification_id,
    tenantId: row.tenant_id,
    destination: row.destination,
    title: row.title,
    body: row.body,
    deepLink: row.deep_link,
    idempotencyKey: row.idempotency_key,
    providerRetryKey: row.provider_retry_key,
    payloadHash: row.payload_hash,
    attempt: row.attempt,
    attemptToken: row.attempt_token,
    leaseExpiresAt: row.lease_expires_at,
  };
}

// claim/finalizeは各々短いtransactionで確定し、LINE送信はtransaction外で行う。
export function createPostgresLineDeliveryRepository(
  database: LineDeliveryDatabase,
): LineDeliveryClaimRepository {
  return {
    claimDue: ({ maxAttempts, leaseMs }) =>
      database.transaction(async (transaction) => {
        const rows = await transaction.queryRaw<ClaimRow[]>`
          SELECT notification_id, tenant_id, destination, title, body, deep_link,
                 idempotency_key, provider_retry_key, payload_hash, attempt,
                 attempt_token, lease_expires_at
            FROM app_claim_line_delivery_outbox(${maxAttempts}::integer, ${leaseMs}::integer)
        `;
        if (!Array.isArray(rows) || rows.length > 1)
          throw new Error('LINE配信claimの応答が不正です。');
        return toClaim(rows[0]);
      }),
    markSent: ({ tenantId, notificationId, attemptToken, providerMessageId }) =>
      database.transaction(async (transaction) => {
        const rows = await transaction.queryRaw<Array<{ outcome: string }>>`
          SELECT outcome FROM app_mark_line_delivery_sent(
            ${tenantId}::uuid, ${notificationId}::uuid,
            ${attemptToken}::uuid, ${providerMessageId}::varchar
          )
        `;
        const outcome = rows[0]?.outcome;
        if (outcome !== 'sent' && outcome !== 'stale')
          throw new Error('LINE配信sent確定の応答が不正です。');
        return outcome;
      }),
    markFailed: ({
      tenantId,
      notificationId,
      attemptToken,
      errorCode,
      retryDelayMs,
    }) =>
      database.transaction(async (transaction) => {
        const rows = await transaction.queryRaw<Array<{ outcome: string }>>`
          SELECT outcome FROM app_mark_line_delivery_failed(
            ${tenantId}::uuid, ${notificationId}::uuid,
            ${attemptToken}::uuid, ${errorCode}::varchar, ${retryDelayMs}::integer
          )
        `;
        const outcome = rows[0]?.outcome;
        if (outcome !== 'failed' && outcome !== 'stale')
          throw new Error('LINE配信failed確定の応答が不正です。');
        return outcome;
      }),
    markUnknown: ({ tenantId, notificationId, attemptToken, errorCode }) =>
      database.transaction(async (transaction) => {
        const rows = await transaction.queryRaw<Array<{ outcome: string }>>`
          SELECT outcome FROM app_mark_line_delivery_unknown(
            ${tenantId}::uuid, ${notificationId}::uuid,
            ${attemptToken}::uuid, ${errorCode}::varchar
          )
        `;
        const outcome = rows[0]?.outcome;
        if (outcome !== 'unknown' && outcome !== 'stale')
          throw new Error('LINE配信unknown確定の応答が不正です。');
        return outcome;
      }),
  };
}

function getErrorCode(
  error: unknown,
  signal: AbortSignal,
): 'aborted' | 'timeout' | 'provider_failure' | 'provider_id_missing' {
  if (signal.aborted) return 'aborted';
  if (error instanceof Error && error.name === 'LineDeliveryTimeoutError')
    return 'timeout';
  if (error instanceof Error && error.name === 'LineDeliveryProviderIdError')
    return 'provider_id_missing';
  return 'provider_failure';
}

function isUnknownDeliveryError(
  errorCode: ReturnType<typeof getErrorCode>,
): errorCode is 'aborted' | 'timeout' | 'provider_id_missing' {
  return (
    errorCode === 'aborted' ||
    errorCode === 'timeout' ||
    errorCode === 'provider_id_missing'
  );
}

async function sendWithTimeout(
  transport: LineDeliveryTransport,
  claim: LineDeliveryClaim,
  parentSignal: AbortSignal,
  timeoutMs: number,
): Promise<{ providerMessageId: string }> {
  if (parentSignal.aborted) throw new Error('schedulerが中断されました。');
  const controller = new AbortController();
  const abort = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new Error('LINE送信timeout'));
      const error = new Error('LINE送信がtimeoutしました。');
      error.name = 'LineDeliveryTimeoutError';
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      transport.send({
        notification: {
          notificationId: claim.notificationId,
          destination: claim.destination,
          title: claim.title,
          body: claim.body,
          deepLink: claim.deepLink,
        },
        idempotencyKey: claim.idempotencyKey,
        retryKey: claim.providerRetryKey,
        signal: controller.signal,
      }),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    parentSignal.removeEventListener('abort', abort);
  }
}

// lease期限を再試行時刻の下限にし、timeout後の遅延処理による即時再claimを防ぐ。
export function createLineDeliveryProcessor(input: {
  repository: LineDeliveryClaimRepository;
  transport: LineDeliveryTransport;
  maxAttempts: number;
  leaseMs: number;
  sendTimeoutMs: number;
  retryBaseDelayMs: number;
  now?: () => Date;
}): LineDeliveryProcessor {
  // retry時刻とleaseはDB時刻で確定する。旧テスト注入値は互換のため受け取るが参照しない。
  void input.now;
  return {
    async processOne({ signal }) {
      const claim = await input.repository.claimDue({
        maxAttempts: input.maxAttempts,
        leaseMs: input.leaseMs,
        signal,
      });
      if (!claim) return 'idle';
      let sent: { providerMessageId: string };
      try {
        sent = await sendWithTimeout(
          input.transport,
          claim,
          signal,
          input.sendTimeoutMs,
        );
      } catch (error) {
        const errorCode = getErrorCode(error, signal);
        if (isUnknownDeliveryError(errorCode))
          return await input.repository.markUnknown({
            tenantId: claim.tenantId,
            notificationId: claim.notificationId,
            attemptToken: claim.attemptToken,
            errorCode,
          });
        return await input.repository.markFailed({
          tenantId: claim.tenantId,
          notificationId: claim.notificationId,
          attemptToken: claim.attemptToken,
          errorCode,
          retryDelayMs:
            claim.attempt < input.maxAttempts
              ? retryDelayMs(claim.attempt, input.retryBaseDelayMs)
              : 0,
        });
      }
      return input.repository.markSent({
        tenantId: claim.tenantId,
        notificationId: claim.notificationId,
        attemptToken: claim.attemptToken,
        providerMessageId: sent.providerMessageId,
      });
    },
  };
}

type WorkerModule = {
  runLineDeliveryWorker?: (input: {
    maxItems: number;
    signal: AbortSignal;
    processOne: LineDeliveryProcessor['processOne'];
  }) => Promise<unknown>;
};

function toWorkerStatus(value: unknown): LineDeliveryWorkerStatus {
  if (
    value === 'idle' ||
    value === 'sent' ||
    value === 'failed' ||
    value === 'unknown'
  )
    return value;
  throw new Error('LINE delivery workerの結果が不正です。');
}

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
  return {
    run: (input) =>
      module
        .runLineDeliveryWorker?.(input)
        .then(toWorkerStatus) as Promise<LineDeliveryWorkerStatus>,
  };
}

function createPrismaDatabase(
  client: ReturnType<typeof createPrismaClient>,
): LineDeliveryDatabase {
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

export function createLineMessagingTransport(
  token: string,
): LineDeliveryTransport {
  return {
    async send({ notification, retryKey, signal }) {
      const text = `${notification.title}\n${notification.body}\n${notification.deepLink}`;
      if (text.length > 5000) throw new Error('LINE通知本文が長すぎます。');
      const response = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Line-Retry-Key': retryKey,
        },
        body: JSON.stringify({
          to: notification.destination,
          messages: [{ type: 'text', text }],
        }),
        signal,
      });
      if (response.status === 409) {
        const error = new Error('LINEプロバイダー409応答');
        error.name = 'LineDeliveryProviderConflictError';
        throw error;
      }
      if (!response.ok) throw new Error('LINEプロバイダー送信失敗');
      const providerMessageId = response.headers
        .get('x-line-request-id')
        ?.trim();
      if (!providerMessageId || providerMessageId.length > 256) {
        const error = new Error('LINEプロバイダーIDがありません。');
        error.name = 'LineDeliveryProviderIdError';
        throw error;
      }
      return {
        providerMessageId,
      };
    },
  };
}

export async function runLineDeliverySchedulerEntry(
  environment: SchedulerEnvironmentInput = process.env,
): Promise<number> {
  let client: ReturnType<typeof createPrismaClient> | null = null;
  try {
    const config = readLineDeliverySchedulerConfig(environment);
    const worker = await loadLineDeliveryWorker(config.workerModule);
    client = createPrismaClient(
      required(environment, 'LINE_DELIVERY_WORKER_DATABASE_URL'),
    );
    const processor = createLineDeliveryProcessor({
      repository: createPostgresLineDeliveryRepository(
        createPrismaDatabase(client),
      ),
      transport: createLineMessagingTransport(
        required(environment, 'LINE_CHANNEL_ACCESS_TOKEN'),
      ),
      maxAttempts: config.notificationMaxAttempts,
      leaseMs: config.leaseMs,
      sendTimeoutMs: config.sendTimeoutMs,
      retryBaseDelayMs: config.retryBaseDelayMs,
    });
    const result = await runLineDeliveryScheduler({
      config,
      worker,
      processor,
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
