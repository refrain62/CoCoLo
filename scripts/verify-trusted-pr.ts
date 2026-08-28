import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertTrustRootReady, readTrustRoot } from './trust-root.ts';
import { assertPullRequestDescription } from './verify-pr-description.ts';

export type PullRequestFile = {
  filename?: string;
  previous_filename?: string;
  status?: string;
};
type PullRequestMetadata = { changed_files?: number; body?: string | null };
type ContentsResponse = { content?: string; encoding?: string };
type TrustedManifest = {
  protected_paths?: string[];
  files?: Record<string, string>;
};
export type BootstrapExtension = {
  schema: 1;
  mode: 'owner-only-one-time';
  owner: '@refrain62';
  head_sha: string;
  files: Record<string, string>;
};

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const maxChangedFiles = 3000;
const maxChangedFilePages = 30;

function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

function assertBootstrapCommitReflected(
  bootstrapCommit: string | null,
  baseSha: string,
): void {
  assert.ok(bootstrapCommit, 'trust rootのbootstrap commitが未設定です。');
  try {
    execFileSync(
      'git',
      ['merge-base', '--is-ancestor', bootstrapCommit, baseSha],
      { cwd: root, stdio: 'ignore' },
    );
  } catch {
    throw new Error(
      'trust rootのowner bootstrap commitがbase branchへ未反映です。quality/security/deployを成功扱いしません。',
    );
  }
}

export function isProtectedPath(filename: string): boolean {
  return (
    filename === '.github/CODEOWNERS' ||
    filename.startsWith('.github/security/') ||
    filename.startsWith('.github/workflows/') ||
    filename === 'package.json' ||
    filename === 'pnpm-lock.yaml' ||
    filename === 'biome.json' ||
    filename === 'tsconfig.scripts.json' ||
    filename === 'packages/db/package.json' ||
    filename === 'packages/db/prisma/schema.prisma' ||
    filename.startsWith('packages/db/prisma/migrations/') ||
    filename === 'packages/db/prisma/migrations.sha256' ||
    filename.startsWith('scripts/')
  );
}

export function assertNoProtectedPathRename(
  filename: string,
  previousFilename?: string,
): void {
  if (previousFilename === undefined) return;
  assert.ok(
    !isProtectedPath(filename) && !isProtectedPath(previousFilename),
    `${filename}: protected pathのrenameは拒否します。`,
  );
}

// one-time拡張は保護対象差分のowner先行登録にだけ適用し、後続の非保護差分を塞がない。
export function assertBootstrapExtensionForChange(
  extension: BootstrapExtension,
  headSha: string,
  protectedChangedNames: readonly string[],
): void {
  if (protectedChangedNames.length === 0) return;
  assert.equal(extension.schema, 1, 'bootstrap extensionのschemaが不正です。');
  assert.equal(extension.mode, 'owner-only-one-time');
  assert.equal(extension.owner, '@refrain62');
  assert.match(
    extension.head_sha,
    /^[0-9a-f]{40}$/,
    'bootstrap extensionのhead SHAが不正です。',
  );
  assert.ok(
    Object.keys(extension.files).length > 0,
    'bootstrap extensionの対象ファイルが空です。',
  );
  for (const [filename, expectedHash] of Object.entries(extension.files)) {
    assert.ok(
      isProtectedPath(filename),
      `${filename}: extension対象が保護範囲外です。`,
    );
    assert.match(
      expectedHash,
      /^[0-9a-f]{64}$/,
      `${filename}: extension hashが不正です。`,
    );
  }
  assert.equal(extension.head_sha, headSha);
  assert.deepEqual(
    Object.keys(extension.files).sort(),
    [...protectedChangedNames].sort(),
    'bootstrap extensionはPRの全保護対象ファイルを過不足なく固定してください。',
  );
}

async function main(): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const token = process.env.GH_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const trustedBaseSha = process.env.TRUSTED_BASE_SHA;
  assert.ok(
    eventPath && token && repository && trustedBaseSha,
    '信頼境界検査のcontextが不足しています。',
  );
  assert.match(trustedBaseSha, /^[0-9a-f]{40}$/, 'base SHAが不正です。');
  assert.notEqual(trustedBaseSha, '0'.repeat(40), 'base SHAがゼロSHAです。');
  assert.equal(
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    trustedBaseSha,
    'base SHA以外をtrust checkerへ渡せません。',
  );
  const trustRoot = await readTrustRoot(root);
  assertTrustRootReady(trustRoot);
  assertBootstrapCommitReflected(trustRoot.bootstrap_commit, trustedBaseSha);

  const event = JSON.parse(await readFile(eventPath, 'utf8')) as {
    pull_request?: { number?: number; head?: { sha?: string } };
  };
  const pullRequestNumber = event.pull_request?.number;
  const headSha = event.pull_request?.head?.sha;
  assert.ok(pullRequestNumber && headSha, 'PR番号またはhead SHAがありません。');
  assert.match(headSha, /^[0-9a-f]{40}$/, 'head SHAが不正です。');
  assert.notEqual(headSha, '0'.repeat(40), 'head SHAがゼロSHAです。');
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
  };
  const apiRoot = `https://api.github.com/repos/${repository}`;
  async function githubJson<T>(url: string): Promise<T> {
    const response = await fetch(url, { headers });
    assert.ok(response.ok, `GitHub APIが失敗しました: ${response.status}`);
    return (await response.json()) as T;
  }

  const pullRequest = await githubJson<PullRequestMetadata>(
    `${apiRoot}/pulls/${pullRequestNumber}`,
  );
  const expectedChangedFiles = pullRequest.changed_files;
  assert.ok(
    typeof expectedChangedFiles === 'number' &&
      Number.isSafeInteger(expectedChangedFiles) &&
      expectedChangedFiles >= 0,
    'PRのchanged_filesが欠落または不正です。',
  );
  assert.ok(
    expectedChangedFiles < maxChangedFiles,
    `PRのchanged_filesが上限${maxChangedFiles}件以上です。`,
  );
  assertPullRequestDescription(pullRequest.body ?? '');

  const changed: PullRequestFile[] = [];
  for (let page = 1; changed.length < expectedChangedFiles; page += 1) {
    assert.ok(
      page <= maxChangedFilePages,
      `PR files APIの取得が${maxChangedFilePages}ページ上限に到達しました。`,
    );
    const files = await githubJson<PullRequestFile[]>(
      `${apiRoot}/pulls/${pullRequestNumber}/files?per_page=100&page=${String(page)}`,
    );
    assert.ok(Array.isArray(files), 'PR files APIの応答が配列ではありません。');
    assert.ok(files.length > 0, 'PR files APIの応答が途中で空になりました。');
    changed.push(...files);
    assert.ok(
      changed.length < maxChangedFiles,
      `PR files APIの取得件数が上限${maxChangedFiles}件に到達しました。`,
    );
    if (page === maxChangedFilePages && files.length === 100)
      throw new Error(
        `PR files APIの取得が${maxChangedFilePages}ページ上限に到達しました。`,
      );
  }
  assert.equal(
    changed.length,
    expectedChangedFiles,
    `PR files APIの取得件数(${changed.length})とchanged_files(${expectedChangedFiles})が一致しません。`,
  );
  assert.ok(
    changed.every((file) => typeof file.filename === 'string'),
    'PR files APIにfilenameがない差分があります。',
  );
  assert.ok(
    changed.every(
      (file) =>
        file.previous_filename === undefined ||
        (typeof file.previous_filename === 'string' &&
          file.previous_filename.length > 0),
    ),
    'PR files APIのprevious_filenameが不正です。',
  );
  const changedNames = changed.map((file) => file.filename as string);
  assert.equal(
    new Set(changedNames).size,
    changed.length,
    'PR files APIが重複したfilenameを返しました。',
  );

  async function headFile(filename: string): Promise<string> {
    const encoded = encodeURIComponent(filename).replaceAll('%2F', '/');
    const response = await githubJson<ContentsResponse>(
      `${apiRoot}/contents/${encoded}?ref=${headSha}`,
    );
    assert.equal(
      response.encoding,
      'base64',
      `${filename}: base64応答が必要です。`,
    );
    assert.ok(response.content, `${filename}: PR headの内容がありません。`);
    return Buffer.from(
      response.content.replaceAll('\n', ''),
      'base64',
    ).toString('utf8');
  }

  const manifest = JSON.parse(
    await readFile(
      path.join(root, '.github/security/trusted-file-manifest.json'),
      'utf8',
    ),
  ) as TrustedManifest;
  const trustedFiles = manifest.files;
  assert.ok(
    trustedFiles && Object.keys(trustedFiles).length > 0,
    '信頼対象manifestが空です。',
  );
  assert.deepEqual(
    manifest.protected_paths?.slice().sort(),
    ['.gitleaks.toml', '.semgrep/ci.yml', '.trivy-secret.yaml'],
    'scanner rule fileのtrusted manifest保護対象が不正です。',
  );
  for (const [filename, expectedHash] of Object.entries(trustedFiles)) {
    assert.ok(
      !path.isAbsolute(filename) && !filename.includes('..'),
      `${filename}: pathが不正です。`,
    );
    assert.match(
      expectedHash,
      /^[0-9a-f]{64}$/,
      `${filename}: hashが不正です。`,
    );
    assert.equal(
      sha256(await readFile(path.join(root, filename))),
      expectedHash,
      `${filename}: base内容とmanifest hashが一致しません。`,
    );
  }

  let extension: BootstrapExtension | undefined;
  try {
    extension = JSON.parse(
      await readFile(
        path.join(root, '.github/security/bootstrap-extension.json'),
        'utf8',
      ),
    ) as BootstrapExtension;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const protectedChangedNames = changed
    .filter((file) => file.filename && isProtectedPath(file.filename))
    .map((file) => file.filename as string)
    .sort();
  if (extension) {
    assertBootstrapExtensionForChange(
      extension,
      headSha,
      protectedChangedNames,
    );
  }

  for (const file of changed) {
    const filename = file.filename as string;
    assertNoProtectedPathRename(filename, file.previous_filename);
    if (!isProtectedPath(filename)) continue;
    if (extension?.files[filename] !== undefined) {
      assert.ok(
        file.status === 'added' || file.status === 'modified',
        `${filename}: extension対象の追加・削除状態が不正です。`,
      );
      assert.equal(
        sha256(await headFile(filename)),
        extension.files[filename],
        `${filename}: owner-only extensionの固定hashとPR headが一致しません。`,
      );
      continue;
    }
    assert.ok(
      Object.hasOwn(trustedFiles, filename),
      `${filename}: manifestにない保護対象です。`,
    );
    assert.equal(
      file.status,
      'modified',
      `${filename}: 追加・削除はfail-closedで拒否します。`,
    );
    assert.equal(
      sha256(await headFile(filename)),
      trustedFiles[filename],
      `${filename}: trust root対象の変更はowner先行commitへ分離してください。`,
    );
  }
  console.log(
    `base SHA ${trustedBaseSha} のtrust rootでPR差分${changed.length}件を検査しました。`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
