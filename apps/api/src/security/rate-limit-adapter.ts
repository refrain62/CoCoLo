import {
  type CentralRateLimitStore as BaseCentralRateLimitStore,
  InMemoryRateLimitStore,
  normalizeRateLimitTimeout,
  type RateLimitConsumeContext,
  type RateLimitConsumeInput,
  type RateLimitConsumeOptions,
  type RateLimitConsumeResult,
  type RateLimitNamespace,
  type RateLimitStore,
  withRateLimitTimeout,
} from './rate-limit.js';
import {
  type RateLimitAdapterModulePolicy,
  validateRateLimitAdapterModule,
} from './rate-limit-adapter-policy.js';

export type RateLimitEnvironment = RateLimitNamespace;
export type RateLimitStoreMode = 'memory' | 'distributed';

/**
 * 分散ストア側でカウンター加算と固定窓の初期化を一つの原子的操作として実行する契約。
 * adapterはハッシュ済みkey、AbortSignal、timeoutを受け取り、tenant/userの生値を受け取らない。
 */
export type DistributedRateLimitAdapter = {
  consumeAtomic: (
    input: RateLimitConsumeInput,
    context: RateLimitConsumeContext,
  ) => Promise<RateLimitConsumeResult>;
};

export type RateLimitAdapterModule = {
  createRateLimitAdapter: () =>
    | DistributedRateLimitAdapter
    | Promise<DistributedRateLimitAdapter>;
};

export type CentralRateLimitStore = BaseCentralRateLimitStore & {
  readonly distributed: true;
  readonly adapter: DistributedRateLimitAdapter;
  readonly namespace: RateLimitEnvironment;
};

export type DistributedRateLimitStoreOptions = {
  adapter: DistributedRateLimitAdapter;
  namespace: RateLimitEnvironment;
  timeoutMs?: number;
};

const hashedRateLimitKeyPattern =
  /^(?:user|client):(local|staging|production):[a-f0-9]{64}:[a-f0-9]{64}$/;

// 外部adapterへ渡すキーを形式検査し、PIIや環境をまたぐkeyを外部ストアへ流さないようにする。
export function isHashedRateLimitKey(
  key: string,
  namespace?: RateLimitEnvironment,
): boolean {
  if (typeof key !== 'string') return false;
  const match = hashedRateLimitKeyPattern.exec(key);
  return Boolean(match && (!namespace || match[1] === namespace));
}

function assertDistributedRateLimitAdapter(
  value: unknown,
): asserts value is DistributedRateLimitAdapter {
  if (
    !value ||
    typeof value !== 'object' ||
    !('consumeAtomic' in value) ||
    typeof value.consumeAtomic !== 'function'
  )
    throw new Error('分散rate limit adapterの契約が不正です。');
}

function assertConsumeInput(
  input: RateLimitConsumeInput,
  namespace: RateLimitEnvironment,
) {
  if (
    !input ||
    typeof input !== 'object' ||
    !isHashedRateLimitKey(input.key, namespace) ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    !Number.isInteger(input.windowMs) ||
    input.windowMs < 1 ||
    !Number.isFinite(input.nowMs)
  )
    throw new Error('分散rate limitの入力契約が不正です。');
}

function assertConsumeResult(
  input: RateLimitConsumeInput,
  result: RateLimitConsumeResult,
) {
  if (
    !result ||
    typeof result !== 'object' ||
    typeof result.allowed !== 'boolean' ||
    !Number.isInteger(result.remaining) ||
    result.remaining < 0 ||
    result.remaining > input.limit ||
    !Number.isFinite(result.resetAtMs) ||
    result.resetAtMs <= input.nowMs
  )
    throw new Error('分散rate limit adapterの応答契約が不正です。');
}

function assertNamespace(
  namespace: string,
): asserts namespace is RateLimitEnvironment {
  if (
    namespace !== 'local' &&
    namespace !== 'staging' &&
    namespace !== 'production'
  )
    throw new Error('rate limit namespaceが不正です。');
}

function isStoreOptions(
  value: DistributedRateLimitAdapter | DistributedRateLimitStoreOptions,
): value is DistributedRateLimitStoreOptions {
  return 'adapter' in value && 'namespace' in value;
}

// adapterを中央RateLimitStore契約へ明示接続し、distributed=trueと環境namespaceを保持する。
export function createDistributedRateLimitStore(
  adapter: DistributedRateLimitAdapter,
  options?: { namespace?: RateLimitEnvironment; timeoutMs?: number },
): CentralRateLimitStore;
export function createDistributedRateLimitStore(
  options: DistributedRateLimitStoreOptions,
): CentralRateLimitStore;
export function createDistributedRateLimitStore(
  adapterOrOptions:
    | DistributedRateLimitAdapter
    | DistributedRateLimitStoreOptions,
  options: { namespace?: RateLimitEnvironment; timeoutMs?: number } = {},
): CentralRateLimitStore {
  const adapter = isStoreOptions(adapterOrOptions)
    ? adapterOrOptions.adapter
    : adapterOrOptions;
  const namespace = isStoreOptions(adapterOrOptions)
    ? adapterOrOptions.namespace
    : (options.namespace ?? 'local');
  const timeoutMs = normalizeRateLimitTimeout(
    isStoreOptions(adapterOrOptions)
      ? adapterOrOptions.timeoutMs
      : options.timeoutMs,
  );
  assertNamespace(namespace);
  assertDistributedRateLimitAdapter(adapter);

  return {
    distributed: true,
    adapter,
    namespace,
    async consume(input, consumeOptions?: RateLimitConsumeOptions) {
      assertConsumeInput(input, namespace);
      return withRateLimitTimeout(
        async (context) => {
          const result = await adapter.consumeAtomic(input, context);
          assertConsumeResult(input, result);
          return result;
        },
        {
          signal: consumeOptions?.signal,
          timeoutMs: consumeOptions?.timeoutMs ?? timeoutMs,
        },
      );
    },
  };
}

export type ConfiguredRateLimitStoreOptions = {
  appEnv: RateLimitEnvironment;
  mode: RateLimitStoreMode;
  adapter?: DistributedRateLimitAdapter;
  distributedAdapter?: DistributedRateLimitAdapter;
  localStore?: InMemoryRateLimitStore;
  timeoutMs?: number;
};

// localはin-memoryだけを許可し、staging/productionは分散adapterがない限り起動構成を拒否する。
export function createConfiguredRateLimitStore(
  options: ConfiguredRateLimitStoreOptions,
): RateLimitStore {
  const adapter = options.adapter ?? options.distributedAdapter;
  if (
    options.adapter &&
    options.distributedAdapter &&
    options.adapter !== options.distributedAdapter
  )
    throw new Error('rate limit adapterが重複指定されています。');

  if (options.appEnv === 'local') {
    if (options.mode !== 'memory' || adapter)
      throw new Error(
        'local環境のrate limit storeはin-memoryだけを指定してください。',
      );
    return options.localStore ?? new InMemoryRateLimitStore();
  }

  if (options.mode !== 'distributed')
    throw new Error(
      'staging/production環境では分散rate limit storeが必要です。',
    );
  if (options.localStore)
    throw new Error(
      'staging/production環境ではin-memory rate limit storeを注入できません。',
    );
  if (!adapter)
    throw new Error(
      'staging/production環境の分散rate limit adapterが未設定です。',
    );
  return createDistributedRateLimitStore({
    adapter,
    namespace: options.appEnv,
    timeoutMs: options.timeoutMs,
  });
}

// 配置先が提供するNode moduleをallowlistとlockfileへ照合してから読み込み、未設定・契約違反を拒否する。
export async function loadDistributedRateLimitAdapter(
  moduleSpecifier: string,
  policy?: RateLimitAdapterModulePolicy,
): Promise<DistributedRateLimitAdapter> {
  const normalizedSpecifier = validateRateLimitAdapterModule(
    moduleSpecifier,
    policy,
  );
  const loaded = (await import(
    normalizedSpecifier
  )) as Partial<RateLimitAdapterModule>;
  if (typeof loaded.createRateLimitAdapter !== 'function')
    throw new Error(
      '分散rate limit adapter moduleにcreateRateLimitAdapterがありません。',
    );

  const adapter = await loaded.createRateLimitAdapter();
  assertDistributedRateLimitAdapter(adapter);
  return adapter;
}

export {
  bundledRateLimitAdapterPackages,
  extractPnpmLockfilePackageNames,
  type RateLimitAdapterModulePolicy,
  validateRateLimitAdapterModule,
} from './rate-limit-adapter-policy.js';
