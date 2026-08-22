import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type MigrationChecksum = Readonly<{
  path: string;
  sha256: string;
}>;

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const migrationsRoot = path.join(
  root,
  'packages',
  'db',
  'prisma',
  'migrations',
);
const manifestPath = path.join(
  root,
  'packages',
  'db',
  'prisma',
  'migrations.sha256',
);

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

// 相対パスを正本に含めることで、既存migrationの編集だけでなく追加・削除も検出する。
export function formatMigrationManifest(entries: readonly MigrationChecksum[]) {
  const sortedEntries = [...entries].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  assert.ok(sortedEntries.length > 0, 'migration checksumが1件以上必要です。');
  const seenPaths = new Set<string>();
  for (const entry of sortedEntries) {
    assert.match(entry.sha256, /^[0-9a-f]{64}$/, `${entry.path}: SHA-256が不正です`);
    assert.match(
      entry.path,
      /^[^/\\]+\/migration\.sql$/,
      `${entry.path}: migration.sqlの相対パスが不正です`,
    );
    assert.ok(!seenPaths.has(entry.path), `${entry.path}: 重複しています`);
    seenPaths.add(entry.path);
  }
  return `${sortedEntries.map((entry) => `${entry.sha256}  ${entry.path}`).join('\n')}\n`;
}

export function parseMigrationManifest(content: string) {
  assert.ok(!content.includes('\r'), 'checksum manifestはLF改行にしてください');
  assert.ok(content.endsWith('\n'), 'checksum manifestは末尾をLF改行にしてください');
  const lines = content.slice(0, -1).split('\n');
  assert.ok(lines.length > 0 && lines[0], 'checksum manifestが空です');
  const entries: MigrationChecksum[] = [];
  for (const [index, line] of lines.entries()) {
    const match = /^(?<sha256>[0-9a-f]{64})  (?<path>[^/\\]+\/migration\.sql)$/.exec(
      line,
    );
    const groups = match?.groups;
    assert.ok(groups, `checksum manifest ${index + 1}行目の形式が不正です`);
    assert.ok(groups.path, `checksum manifest ${index + 1}行目のパスが空です`);
    assert.ok(groups.sha256, `checksum manifest ${index + 1}行目のchecksumが空です`);
    entries.push({
      path: groups.path,
      sha256: groups.sha256,
    });
  }
  return entries;
}

export function verifyMigrationManifest(
  actual: readonly MigrationChecksum[],
  manifestContent: string,
) {
  const expected = parseMigrationManifest(manifestContent);
  const actualText = formatMigrationManifest(actual);
  const expectedText = formatMigrationManifest(expected);
  assert.equal(
    expectedText,
    actualText,
    'migration checksumが一致しません。SQLの編集・追加・削除を確認してください',
  );
}

async function readMigrationChecksums() {
  const directories = await readdir(migrationsRoot, { withFileTypes: true });
  const migrationDirectories = directories
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const entries: MigrationChecksum[] = [];
  for (const directory of migrationDirectories) {
    const relativePath = `${directory.name}/migration.sql`;
    const bytes = await readFile(path.join(migrationsRoot, relativePath));
    entries.push({ path: relativePath, sha256: sha256(bytes) });
  }
  return entries;
}

async function main() {
  const actual = await readMigrationChecksums();
  if (process.argv.includes('--write')) {
    await writeFile(manifestPath, formatMigrationManifest(actual), 'utf8');
    console.log(`migration checksumを更新しました（${actual.length}件）。`);
    return;
  }
  verifyMigrationManifest(actual, await readFile(manifestPath, 'utf8'));
  console.log(`migration checksum ${actual.length}件を検証しました。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
