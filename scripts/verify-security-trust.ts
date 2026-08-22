import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  'scripts/security-scanner-summary.ts',
  'scripts/security-scanner.test.ts',
  'scripts/verify-security-scanners.ts',
  'scripts/verify-security-trust.ts',
  'scripts/verify-workflows.ts',
  'scripts/verify-workflows.test.ts',
  '.github/security/fixtures/malicious-scanner-pr.json',
] as const;

export type TrustedFileHashes = Record<string, string>;

function assertCommitSha(value: string, name: string): void {
  if (!shaPattern.test(value))
    throw new Error(`${name}は40桁の小文字hex SHAで指定してください。`);
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

function readTrustedHashes(revision: string): TrustedFileHashes {
  return Object.fromEntries(
    trustedScannerFiles.map((file) => [file, gitFileHash(revision, file)]),
  );
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}が未設定です。`);
  return value;
}

async function main(): Promise<void> {
  const baseSha = requiredEnvironment('TRUST_BASE_SHA');
  const headSha = requiredEnvironment('TRUST_HEAD_SHA');
  assertTrustedFileHashes(
    baseSha,
    headSha,
    readTrustedHashes(baseSha),
    readTrustedHashes(headSha),
  );
  console.log(
    `scanner trust gate: base=${baseSha} head=${headSha} files=${trustedScannerFiles.length}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
