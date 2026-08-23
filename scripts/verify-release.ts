import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type ReleaseManifest = Readonly<{
  artifactSha: string;
  files: readonly string[];
  migrationChecksumSha256: string;
}>;

function normalizedEntry(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function readArchiveEntries(archive: string): string[] {
  const result = spawnSync('tar', ['-tzf', archive], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'release.tar.gzの一覧を検証できません。');
  return result.stdout.split(/\r?\n/).map(normalizedEntry).filter(Boolean);
}

function readArchiveFile(archive: string, entry: string): Buffer {
  const result = spawnSync('tar', ['-xOf', archive, entry], {
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${entry}をrelease.tar.gzから読み出せません。`,
  );
  return result.stdout as Buffer;
}

export async function verifyReleaseArtifact(
  output: string,
  expectedSha: string,
): Promise<ReleaseManifest> {
  assert.match(
    expectedSha,
    /^[0-9a-f]{40}$/,
    '成果物の SHA は40桁の小文字 SHA-1 で指定してください。',
  );
  const manifest = JSON.parse(
    await readFile(path.join(output, 'release-manifest.json'), 'utf8'),
  ) as Partial<ReleaseManifest>;
  assert.equal(
    manifest.artifactSha,
    expectedSha,
    'マニフェストの commit SHA が一致しません。',
  );
  assert.ok(
    Array.isArray(manifest.files),
    'release manifestのfilesが不正です。',
  );
  assert.ok(
    typeof manifest.migrationChecksumSha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(manifest.migrationChecksumSha256),
    'migration checksumのSHA-256がmanifestにありません。',
  );
  assert.ok(
    manifest.files.includes('packages/db/prisma/migrations.sha256'),
    'release artifactにmigration checksum manifestがありません。',
  );

  const archivePath = path.join(output, 'release.tar.gz');
  const archive = await readFile(archivePath);
  const actualDigest = createHash('sha256').update(archive).digest('hex');
  const checksum = (
    await readFile(path.join(output, 'artifact.sha256'), 'utf8')
  )
    .trim()
    .split(/\s+/)[0];
  assert.equal(
    actualDigest,
    checksum,
    'リリース成果物のSHA-256が一致しません。',
  );

  const archiveEntries = new Set(readArchiveEntries(archivePath));
  for (const file of manifest.files) {
    const normalized = normalizedEntry(file);
    assert.ok(
      archiveEntries.has(normalized) ||
        [...archiveEntries].some((entry) => entry.startsWith(`${normalized}/`)),
      `release artifactに${file}がありません。`,
    );
  }
  const migrationManifest = readArchiveFile(
    archivePath,
    'packages/db/prisma/migrations.sha256',
  );
  assert.equal(
    createHash('sha256').update(migrationManifest).digest('hex'),
    manifest.migrationChecksumSha256,
    'release artifact内のmigration checksumがmanifestと一致しません。',
  );
  return manifest as ReleaseManifest;
}

async function main(): Promise<void> {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const outputIndex = process.argv.indexOf('--release-dir');
  const output =
    outputIndex === -1
      ? path.join(root, '.release')
      : process.argv[outputIndex + 1];
  assert.ok(output, 'release directoryが必要です。');
  const shaIndex = process.argv.indexOf('--artifact-sha');
  const expectedSha =
    (shaIndex === -1 ? undefined : process.argv[shaIndex + 1]) ??
    process.env.ARTIFACT_SHA;
  assert.ok(expectedSha, '成果物の SHA が必要です。');
  await verifyReleaseArtifact(output, expectedSha);
  console.log(
    'リリース成果物のSHA-256・migration checksum・commit SHAを検証しました。',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
