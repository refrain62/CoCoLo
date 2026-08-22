import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

const packageNamePattern =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/;
const builtinPackageNames = new Set(
  builtinModules.map((moduleName) => moduleName.replace(/^node:/, '')),
);

// 実providerをこのrepositoryへ同梱するまで空のままにし、未承認moduleの動的importを許可しない。
export const bundledRateLimitAdapterPackages = [] as const;

export type RateLimitAdapterModulePolicy = {
  allowedPackages?: readonly string[];
  lockfilePackages?: ReadonlySet<string> | readonly string[];
};

function hasUnsafeControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function toPackageSet(
  packages: ReadonlySet<string> | readonly string[],
): ReadonlySet<string> {
  return packages instanceof Set ? packages : new Set(packages);
}

export function extractPnpmLockfilePackageNames(contents: string): Set<string> {
  const packages = new Set<string>();
  for (const line of contents.split('\n')) {
    const match = line.match(/^ {2}(?:'([^']+)'|([^:]+)):/);
    const key = match?.[1] ?? match?.[2];
    if (!key) continue;
    const separator = key.startsWith('@')
      ? key.indexOf('@', key.indexOf('/') + 1)
      : key.indexOf('@');
    if (separator > 0) packages.add(key.slice(0, separator));
  }
  return packages;
}

export function readPnpmLockfilePackageNames(
  startDirectory = process.cwd(),
): ReadonlySet<string> {
  let directory = path.resolve(startDirectory);
  while (true) {
    try {
      const contents = readFileSync(
        path.join(directory, 'pnpm-lock.yaml'),
        'utf8',
      );
      return extractPnpmLockfilePackageNames(contents);
    } catch {
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  throw new Error(
    'pnpm lockfileが見つからないためadapter moduleを検証できません。',
  );
}

// package名、lockfile、明示allowlistをすべて照合し、URLやfilesystemへのimportを拒否する。
export function validateRateLimitAdapterModule(
  moduleSpecifier: string,
  policy: RateLimitAdapterModulePolicy = {},
): string {
  const normalizedSpecifier = moduleSpecifier.trim();
  if (!normalizedSpecifier)
    throw new Error('分散rate limit adapter moduleが未設定です。');
  if (
    hasUnsafeControlCharacter(normalizedSpecifier) ||
    /\s/.test(normalizedSpecifier) ||
    /[\\?#%]/.test(normalizedSpecifier) ||
    /^[./]/.test(normalizedSpecifier) ||
    /^[a-z][a-z\d+.-]*:/i.test(normalizedSpecifier) ||
    !packageNamePattern.test(normalizedSpecifier)
  )
    throw new Error(
      'RATE_LIMIT_ADAPTER_MODULEには許可されたNode package名だけを指定してください。',
    );
  if (builtinPackageNames.has(normalizedSpecifier))
    throw new Error(
      'RATE_LIMIT_ADAPTER_MODULEには許可されたNode package名だけを指定してください。',
    );

  const allowedPackages = new Set(
    policy.allowedPackages ?? bundledRateLimitAdapterPackages,
  );
  if (!allowedPackages.has(normalizedSpecifier))
    throw new Error(
      'RATE_LIMIT_ADAPTER_MODULEが許可されたadapter package allowlistにありません。',
    );

  const lockfilePackages = toPackageSet(
    policy.lockfilePackages ?? readPnpmLockfilePackageNames(),
  );
  if (!lockfilePackages.has(normalizedSpecifier))
    throw new Error(
      'RATE_LIMIT_ADAPTER_MODULEがpnpm lockfileの許可パッケージにありません。',
    );
  return normalizedSpecifier;
}
