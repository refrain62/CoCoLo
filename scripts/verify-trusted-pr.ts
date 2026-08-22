import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertTrustRootReady, readTrustRoot } from './trust-root.ts';

type PullRequestFile = { filename?: string; status?: string };
type ContentsResponse = { content?: string; encoding?: string };
type TrustedManifest = { files?: Record<string, string> };

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
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
    filename === 'packages/db/prisma/schema.prisma' ||
    filename.startsWith('packages/db/prisma/migrations/') ||
    filename === 'packages/db/prisma/migrations.sha256' ||
    filename.startsWith('scripts/')
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
  assert.equal(
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    trustedBaseSha,
    'base SHA以外をtrust checkerへ渡せません。',
  );
  assertTrustRootReady(await readTrustRoot(root));

  const event = JSON.parse(await readFile(eventPath, 'utf8')) as {
    pull_request?: { number?: number; head?: { sha?: string } };
  };
  const pullRequestNumber = event.pull_request?.number;
  const headSha = event.pull_request?.head?.sha;
  assert.ok(pullRequestNumber && headSha, 'PR番号またはhead SHAがありません。');
  assert.match(headSha, /^[0-9a-f]{40}$/, 'head SHAが不正です。');
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
  const changed: PullRequestFile[] = [];
  for (let page = 1; ; page += 1) {
    const files = await githubJson<PullRequestFile[]>(
      `${apiRoot}/pulls/${pullRequestNumber}/files?per_page=100&page=${String(page)}`,
    );
    changed.push(...files);
    if (files.length < 100) break;
  }
  async function headFile(filename: string): Promise<string> {
    const encoded = encodeURIComponent(filename).replaceAll('%2F', '/');
    const response = await githubJson<ContentsResponse>(
      `${apiRoot}/contents/${encoded}?ref=${headSha}`,
    );
    assert.equal(response.encoding, 'base64', `${filename}: base64応答が必要です。`);
    assert.ok(response.content, `${filename}: PR headの内容がありません。`);
    return Buffer.from(response.content.replaceAll('\n', ''), 'base64').toString('utf8');
  }

  const manifest = JSON.parse(
    await readFile(path.join(root, '.github/security/trusted-file-manifest.json'), 'utf8'),
  ) as TrustedManifest;
  const trustedFiles = manifest.files;
  assert.ok(trustedFiles && Object.keys(trustedFiles).length > 0, '信頼対象manifestが空です。');
  for (const [filename, expectedHash] of Object.entries(trustedFiles)) {
    assert.ok(!path.isAbsolute(filename) && !filename.includes('..'), `${filename}: pathが不正です。`);
    assert.match(expectedHash, /^[0-9a-f]{64}$/, `${filename}: hashが不正です。`);
    assert.equal(
      sha256(await readFile(path.join(root, filename))),
      expectedHash,
      `${filename}: base内容とmanifest hashが一致しません。`,
    );
  }
  for (const file of changed) {
    const filename = file.filename;
    assert.ok(filename, 'filenameがないPR差分です。');
    if (!isProtectedPath(filename)) continue;
    assert.ok(Object.hasOwn(trustedFiles, filename), `${filename}: manifestにない保護対象です。`);
    assert.equal(file.status, 'modified', `${filename}: 追加・削除はfail-closedで拒否します。`);
    assert.equal(
      sha256(await headFile(filename)),
      trustedFiles[filename],
      `${filename}: trust root対象の変更はowner先行commitへ分離してください。`,
    );
  }
  console.log(`base SHA ${trustedBaseSha} のtrust rootでPR差分${changed.length}件を検査しました。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
