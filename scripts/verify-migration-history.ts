import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withPostgresClient } from './postgres-client.ts';
import {
  type MigrationChecksum,
  migrationPaths,
  parseMigrationManifest,
} from './verify-migration-checksum.ts';

export type MigrationHistory = Readonly<{
  migrationName: string;
  checksum: string;
  finishedAt: Date | string | null;
  rolledBackAt: Date | string | null;
}>;

function migrationName(entry: MigrationChecksum): string {
  return entry.path.slice(0, -'/migration.sql'.length);
}

// DB履歴を正本と完全一致させ、未適用・余分・改変・未完了・rollback済みを成功扱いにしない。
export function verifyMigrationHistory(
  expected: readonly MigrationChecksum[],
  actual: readonly MigrationHistory[],
): void {
  assert.equal(
    actual.length,
    expected.length,
    'DBのmigration履歴件数が正本と一致しません。未適用・余分な履歴を確認してください。',
  );
  const actualByName = new Map<string, MigrationHistory>();
  for (const entry of actual) {
    assert.ok(
      !actualByName.has(entry.migrationName),
      `${entry.migrationName}: DB履歴が重複しています。`,
    );
    actualByName.set(entry.migrationName, entry);
  }

  for (const [index, expectedEntry] of expected.entries()) {
    const name = migrationName(expectedEntry);
    const entry = actual[index];
    assert.ok(entry, `${name}: DB履歴にありません。`);
    assert.equal(
      entry.migrationName,
      name,
      `${name}: DB履歴の適用順序が正本と一致しません。`,
    );
    assert.equal(
      entry.checksum,
      expectedEntry.sha256,
      `${name}: DB checksumが不一致です。`,
    );
    assert.ok(entry.finishedAt, `${name}: migrationが未完了です。`);
    assert.equal(entry.rolledBackAt, null, `${name}: rollback済みです。`);
  }
  for (const name of actualByName.keys()) {
    assert.ok(
      expected.some((entry) => migrationName(entry) === name),
      `${name}: 正本にないDB履歴です。`,
    );
  }
}

export async function readMigrationHistory(
  directDatabaseUrl: string,
): Promise<readonly MigrationHistory[]> {
  assert.ok(directDatabaseUrl, 'migration履歴検証にはDIRECT_URLが必要です。');
  return withPostgresClient(directDatabaseUrl, (client) =>
    client.$queryRawUnsafe<MigrationHistory[]>(
      `SELECT migration_name AS "migrationName",
              checksum,
              finished_at AS "finishedAt",
              rolled_back_at AS "rolledBackAt"
        FROM "_prisma_migrations"
       ORDER BY started_at ASC, migration_name ASC`,
    ),
  );
}

export async function verifyMigrationHistoryAtDatabase(
  directDatabaseUrl: string,
  root = path.dirname(path.dirname(fileURLToPath(import.meta.url))),
): Promise<void> {
  const { manifestPath } = migrationPaths(root);
  const expected = parseMigrationManifest(await readFile(manifestPath, 'utf8'));
  verifyMigrationHistory(
    expected,
    await readMigrationHistory(directDatabaseUrl),
  );
}

async function main(): Promise<void> {
  const directUrl = process.env.DIRECT_URL;
  assert.ok(directUrl, 'migration履歴検証にはDIRECT_URLが必要です。');
  await verifyMigrationHistoryAtDatabase(directUrl);
  console.log('DB migration履歴をchecksum・適用順序と照合しました。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
