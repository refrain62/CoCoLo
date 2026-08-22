import {
  InMemoryRateLimitStore,
  type RateLimitConsumeInput,
  type RateLimitConsumeResult,
  type RateLimitStore,
} from './rate-limit.js';

export type RateLimitEnvironment = 'local' | 'staging' | 'production';
export type RateLimitStoreMode = 'memory' | 'distributed';

/**
 * 分散ストア側でカウンター加算と固定窓の初期化を一つの原子的操作として実行する契約。
 * 入力keyは既にハッシュ化済みであり、adapterはtenant/userの生値を受け取らない。
 */
export type DistributedRateLimitAdapter = {
  consumeAtomic: (
    input: RateLimitConsumeInput,
  ) => Promise<RateLimitConsumeResult>;
};

export type RateLimitAdapterModule = {
  createRateLimitAdapter: () =>
    | DistributedRateLimitAdapter
    | Promise<DistributedRateLimitAdapter>;
};

const hashedRateLimitKeyPattern = /^(?:user|client):[a-f0-9]{64}:[a-f0-9]{64}$/;

// 外部adapterへ渡すキーを形式検査し、PIIや未ハッシュの識別子が外部ストアへ流れないようにする。
export function isHashedRateLimitKey(key: string): boolean {
  return hashedRateLimitKeyPattern.test(key);
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

function assertConsumeInput(input: RateLimitConsumeInput) {
  if (
    !isHashedRateLimitKey(input.key) ||
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
    typeof result.allowed !== 'boolean' ||
    !Number.isInteger(result.remaining) ||
    result.remaining < 0 ||
    result.remaining > input.limit ||
    !Number.isFinite(result.resetAtMs) ||
    result.resetAtMs <= input.nowMs
  )
    throw new Error('分散rate limit adapterの応答契約が不正です。');
}

// adapterの公開契約を既存RateLimitStoreへ変換し、固定窓の原子性をprovider実装へ委譲する。
export function createDistributedRateLimitStore(
  adapter: DistributedRateLimitAdapter,
): RateLimitStore {
  assertDistributedRateLimitAdapter(adapter);
  return {
    async consume(input) {
      assertConsumeInput(input);
      const result = await adapter.consumeAtomic(input);
      assertConsumeResult(input, result);
      return result;
    },
  };
}

export type ConfiguredRateLimitStoreOptions = {
  appEnv: RateLimitEnvironment;
  mode: RateLimitStoreMode;
  distributedAdapter?: DistributedRateLimitAdapter;
  localStore?: InMemoryRateLimitStore;
};

// localはin-memoryだけを許可し、staging/productionは分散adapterがない限り起動構成を拒否する。
export function createConfiguredRateLimitStore(
  options: ConfiguredRateLimitStoreOptions,
): RateLimitStore {
  if (options.appEnv === 'local') {
    if (options.mode !== 'memory' || options.distributedAdapter)
      throw new Error(
        'local環境のrate limit storeはin-memoryだけを指定してください。',
      );
    return options.localStore ?? new InMemoryRateLimitStore();
  }

  if (options.mode !== 'distributed')
    throw new Error(
      'staging/production環境では分散rate limit storeが必要です。',
    );
  if (!options.distributedAdapter)
    throw new Error(
      'staging/production環境の分散rate limit adapterが未設定です。',
    );
  return createDistributedRateLimitStore(options.distributedAdapter);
}

// 配置先が提供するNode moduleを明示契約で読み込み、未設定・契約違反を起動時に拒否する。
export async function loadDistributedRateLimitAdapter(
  moduleSpecifier: string,
): Promise<DistributedRateLimitAdapter> {
  const normalizedSpecifier = moduleSpecifier.trim();
  if (!normalizedSpecifier)
    throw new Error('分散rate limit adapter moduleが未設定です。');

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
