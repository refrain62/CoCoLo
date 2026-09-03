import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const shaPattern = /^[0-9a-f]{40}$/;
const fileHashPattern = /^[0-9a-f]{64}$/;

// PRから変更されると検査結果そのものを差し替えられるファイルを、base側の参照として固定する。
export const trustedScannerFiles = [
  '.github/CODEOWNERS',
  '.github/security/scanner-exceptions.json',
  '.github/security/security-scanners.json',
  '.github/workflows/quality.yml',
  '.github/workflows/security-scanners.yml',
  '.github/workflows/staging-deploy.yml',
  '.github/workflows/production-promote.yml',
  '.gitleaks.toml',
  '.semgrep/ci.yml',
  '.trivy-secret.yaml',
  'package.json',
  'pnpm-lock.yaml',
  'scripts/run-security-scanners.ts',
  'scripts/prepare-security-target.ts',
  'scripts/security-scan-root.ts',
  'scripts/security-scanner-config.ts',
  'scripts/security-scanner-exceptions.ts',
  'scripts/security-scanner-summary.ts',
  'scripts/security-scanner.test.ts',
  'scripts/verify-security-scanners.ts',
  'scripts/verify-security-trust.ts',
  'scripts/verify-workflows.ts',
  'scripts/verify-workflows.test.ts',
  'scripts/trust-root.ts',
  'scripts/verify-pr-description.ts',
  'scripts/verify-trusted-pr.ts',
  '.github/security/fixtures/malicious-scanner-pr.json',
] as const;

export type TrustedFileHashes = Record<string, string>;
type BootstrapExtension = {
  schema: 1;
  mode: 'owner-only-one-time';
  owner: '@refrain62';
  head_sha: string;
  files: Record<string, string>;
};

function assertCommitSha(value: string, name: string): void {
  if (!shaPattern.test(value))
    throw new Error(`${name}は40桁の小文字hex SHAで指定してください。`);
  if (value === '0'.repeat(40)) throw new Error(`${name}がゼロSHAです。`);
}

function assertHash(value: string, file: string, revision: string): void {
  if (!fileHashPattern.test(value))
    throw new Error(`${revision}:${file}のSHA-256が欠落または不正です。`);
}

// base/headのSHAと全ファイルhashを比較し、参照不能・欠落・改変を合格にしない。
export function assertTrustedFileHashes(
  baseSha: string,
  headSha: string,
  baseHashes: TrustedFileHashes,
  headHashes: TrustedFileHashes,
): void {
  assertCommitSha(baseSha, 'base SHA');
  assertCommitSha(headSha, 'head SHA');
  for (const file of trustedScannerFiles) {
    const baseHash = baseHashes[file];
    const headHash = headHashes[file];
    if (baseHash === undefined || headHash === undefined)
      throw new Error(`信頼対象ファイルのhashが欠落しています: ${file}`);
    assertHash(baseHash, file, baseSha);
    assertHash(headHash, file, headSha);
    if (baseHash !== headHash)
      throw new Error(
        `base側の信頼対象ファイルがheadで改変されています: ${file}`,
      );
  }
}

// owner-only extensionで事前登録されたscanner変更だけを例外として許可する。
export function assertBootstrapTrustedChanges(
  headSha: string,
  headHashes: TrustedFileHashes,
  extension: BootstrapExtension,
  changedFiles: readonly string[],
): void {
  assertCommitSha(headSha, 'head SHA');
  assert.equal(extension.schema, 1, 'bootstrap extensionのschemaが不正です。');
  assert.equal(extension.mode, 'owner-only-one-time');
  assert.equal(extension.owner, '@refrain62');
  assert.equal(extension.head_sha, headSha);
  assert.ok(
    extension.files &&
      typeof extension.files === 'object' &&
      !Array.isArray(extension.files),
    'bootstrap extensionの対象ファイルが不正です。',
  );
  const trustedChangedFiles = changedFiles.filter((file) =>
    trustedScannerFiles.includes(file as (typeof trustedScannerFiles)[number]),
  );
  assert.ok(trustedChangedFiles.length > 0, 'scanner変更がありません。');
  assert.deepEqual(
    Object.keys(extension.files).sort(),
    [...trustedChangedFiles].sort(),
    'bootstrap extensionは変更されたscannerファイルを過不足なく固定してください。',
  );
  for (const file of trustedChangedFiles) {
    const hash = extension.files[file];
    assert.match(
      hash ?? '',
      fileHashPattern,
      `${file}: extension hashが不正です。`,
    );
    assert.equal(
      headHashes[file],
      hash,
      `${file}: owner-only extensionの固定hashとheadが一致しません。`,
    );
  }
}

function gitFileHash(revision: string, file: string): string {
  let content: Buffer;
  try {
    content = execFileSync('git', ['show', `${revision}:${file}`], {
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(
      `信頼対象ファイルをbase/headから取得できません: ${revision}:${file}`,
    );
  }
  return createHash('sha256').update(content).digest('hex');
}

function changedFilesBetween(baseSha: string, headSha: string): string[] {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMRT', baseSha, headSha],
    { encoding: 'utf8' },
  );
  return output.split(/\r?\n/).filter(Boolean);
}

function readTrustedHashes(revision: string): TrustedFileHashes {
  return Object.fromEntries(
    trustedScannerFiles.map((file) => [file, gitFileHash(revision, file)]),
  );
}

async function readBootstrapExtension(): Promise<
  BootstrapExtension | undefined
> {
  try {
    return JSON.parse(
      await readFile(
        path.join(process.cwd(), '.github/security/bootstrap-extension.json'),
        'utf8',
      ),
    ) as BootstrapExtension;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}が未設定です。`);
  return value;
}

async function main(): Promise<void> {
  const baseSha = requiredEnvironment('TRUST_BASE_SHA');
  const headSha = requiredEnvironment('TRUST_HEAD_SHA');
  const changedFiles = changedFilesBetween(baseSha, headSha);
  const trustedChangedFiles = changedFiles.filter((file) =>
    trustedScannerFiles.includes(file as (typeof trustedScannerFiles)[number]),
  );
  const extension = await readBootstrapExtension();
  if (
    extension &&
    trustedChangedFiles.length > 0 &&
    extension.head_sha === headSha
  ) {
    const headHashes = Object.fromEntries(
      trustedChangedFiles.map((file) => [file, gitFileHash(headSha, file)]),
    );
    assertBootstrapTrustedChanges(headSha, headHashes, extension, changedFiles);
  } else {
    assertTrustedFileHashes(
      baseSha,
      headSha,
      readTrustedHashes(baseSha),
      readTrustedHashes(headSha),
    );
  }
  console.log(
    `scanner trust gate: base=${baseSha} head=${headSha} files=${trustedScannerFiles.length}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
