import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertTrustRootReady, readTrustRoot } from './trust-root.ts';

type TrustedManifest = {
  protected_paths?: string[];
  files?: Record<string, string>;
};
type BootstrapExtension = {
  schema: 1;
  mode: 'owner-only-one-time';
  owner: '@refrain62';
  head_sha: string;
  files: Record<string, string>;
};

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function trackedFiles(
  directory: string,
  prefix: string,
): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory())
      result.push(...(await trackedFiles(absolute, relative)));
    else if (entry.isFile()) result.push(relative);
  }
  return result;
}

async function requiredManifestPaths(): Promise<string[]> {
  const required = [
    '.github/CODEOWNERS',
    '.github/security/bootstrap-extension.json',
    '.github/security/trust-root.json',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'biome.json',
    'tsconfig.scripts.json',
    'packages/db/package.json',
    'packages/db/prisma/schema.prisma',
  ];
  for (const directory of [
    '.github/workflows',
    'scripts',
    'packages/db/prisma/migrations',
  ]) {
    const absolute = path.join(root, directory);
    try {
      required.push(
        ...(await trackedFiles(absolute, directory.replaceAll('\\', '/'))),
      );
    } catch {
      if (directory === 'scripts') throw new Error('scriptsがありません。');
    }
  }
  const checksumPath = path.join(root, 'packages/db/prisma/migrations.sha256');
  try {
    await readFile(checksumPath);
    required.push('packages/db/prisma/migrations.sha256');
  } catch {
    // PR #41のbaseにはchecksum manifestがまだないため、存在する場合だけ要求する。
  }
  return [...new Set(required)].sort();
}

export async function verifyTrustRoot(): Promise<void> {
  const trustRoot = await readTrustRoot(root);
  assertTrustRootReady(trustRoot);
  assert.ok(trustRoot.bootstrap_commit, 'bootstrap commitが未設定です。');
  const currentSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  try {
    execFileSync(
      'git',
      ['merge-base', '--is-ancestor', trustRoot.bootstrap_commit, currentSha],
      { cwd: root, stdio: 'ignore' },
    );
  } catch {
    throw new Error(
      'owner bootstrap commitがcheckoutへ未反映です。quality/security/deployを成功扱いしません。',
    );
  }

  const manifestPath = path.join(
    root,
    '.github/security/trusted-file-manifest.json',
  );
  const manifest = JSON.parse(
    await readFile(manifestPath, 'utf8'),
  ) as TrustedManifest;
  assert.ok(manifest.files, '信頼対象manifestがありません。');
  assert.deepEqual(
    manifest.protected_paths?.slice().sort(),
    ['.gitleaks.toml', '.semgrep/ci.yml', '.trivy-secret.yaml'],
    'scanner rule fileのtrusted manifest保護対象が不正です。',
  );
  const files = manifest.files;
  for (const filename of await requiredManifestPaths()) {
    assert.ok(
      Object.hasOwn(files, filename),
      `${filename}: trust rootのmanifestから欠落しています。`,
    );
  }
  for (const [filename, expectedHash] of Object.entries(files)) {
    assert.match(
      expectedHash,
      /^[0-9a-f]{64}$/,
      `${filename}: hashが不正です。`,
    );
    assert.ok(
      !path.isAbsolute(filename) && !filename.includes('..'),
      `${filename}: manifest pathが安全ではありません。`,
    );
    const content = await readFile(path.join(root, filename));
    assert.equal(
      sha256(content),
      expectedHash,
      `${filename}: manifest hashとcheckout内容が一致しません。`,
    );
  }
  const codeowners = await readFile(
    path.join(root, '.github/CODEOWNERS'),
    'utf8',
  );
  assert.match(
    codeowners,
    /^\/scripts\/\*\*\s+@refrain62$/m,
    '秘密情報・deploy呼出しを含むscripts全体をCODEOWNERSで保護してください。',
  );
  const extension = JSON.parse(
    await readFile(
      path.join(root, '.github/security/bootstrap-extension.json'),
      'utf8',
    ),
  ) as BootstrapExtension;
  assert.equal(extension.schema, 1);
  assert.equal(extension.mode, 'owner-only-one-time');
  assert.equal(extension.owner, '@refrain62');
  assert.match(extension.head_sha, /^[0-9a-f]{40}$/);
  assert.ok(Object.keys(extension.files).length > 0);
  for (const [filename, expectedHash] of Object.entries(extension.files)) {
    assert.ok(
      !path.isAbsolute(filename) && !filename.includes('..'),
      `${filename}: extension pathが安全ではありません。`,
    );
    assert.match(expectedHash, /^[0-9a-f]{64}$/);
  }
  console.log('owner bootstrap済みのtrust rootとmanifestを検証しました。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await verifyTrustRoot();
