import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// productionでは再ビルドせず、stagingで検証したmanifest・artifact SHA・checksumだけを受け入れる。
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output =
  process.argv[process.argv.indexOf('--release-dir') + 1] ??
  path.join(root, '.release');
const expectedSha =
  process.argv[process.argv.indexOf('--artifact-sha') + 1] ??
  process.env.ARTIFACT_SHA;
assert.ok(
  expectedSha && /^[0-9a-f]{40}$/.test(expectedSha),
  '成果物の SHA は40桁の小文字 SHA-1 で指定してください。',
);
const manifest = JSON.parse(
  await readFile(path.join(output, 'release-manifest.json'), 'utf8'),
);
assert.equal(
  manifest.artifactSha,
  expectedSha,
  'マニフェストの commit SHA が一致しません。',
);
const archive = await readFile(path.join(output, 'release.tar.gz'));
const actualDigest = createHash('sha256').update(archive).digest('hex');
const checksum = (await readFile(path.join(output, 'artifact.sha256'), 'utf8'))
  .trim()
  .split(/\s+/)[0];
assert.equal(
  actualDigest,
  checksum,
  'リリース成果物の SHA-256 が一致しません。',
);
const runtimePackages = [
  ['apps/api', 'dist/server.js'],
  ['packages/auth', 'dist/index.js'],
  ['packages/contracts', 'dist/index.js'],
  ['packages/db', 'dist/index.js'],
  ['packages/domain', 'dist/index.js'],
] as const;
assert.deepEqual(
  manifest.runtimePackages?.map(
    (runtimePackage: { directory: string; entrypoint: string }) => [
      runtimePackage.directory,
      runtimePackage.entrypoint,
    ],
  ),
  runtimePackages,
  'runtime workspace packageのmanifestが不足しています。',
);
const tarResult = spawnSync(
  'tar',
  ['-tzf', path.join(output, 'release.tar.gz')],
  {
    encoding: 'utf8',
  },
);
assert.equal(tarResult.status, 0, 'release archiveの一覧取得に失敗しました。');
const archiveEntries = new Set(
  tarResult.stdout
    .split(/\r?\n/)
    .map((entry) => entry.replace(/\/$/, ''))
    .filter(Boolean),
);
const hasArchivePath = (entry: string) =>
  archiveEntries.has(entry) ||
  [...archiveEntries].some((candidate) => candidate.startsWith(`${entry}/`));
assert.ok(
  hasArchivePath(manifest.workerEntrypoint),
  'worker entrypointがrelease archiveにありません。',
);
for (const [directory, entrypoint] of runtimePackages) {
  assert.ok(
    hasArchivePath(`${directory}/${entrypoint}`),
    `${directory}/${entrypoint}がrelease archiveにありません。`,
  );
  assert.ok(
    archiveEntries.has(`${directory}/package.json`),
    `${directory}/package.jsonがrelease archiveにありません。`,
  );
}
assert.ok(
  archiveEntries.has('pnpm-workspace.yaml'),
  'pnpm-workspace.yamlがrelease archiveにありません。',
);
console.log(
  'リリース成果物のSHA-256、commit SHA、runtime workspace packageを検証しました。',
);
