import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  parseMigrationManifest,
  type MigrationChecksum,
} from './verify-migration-checksum.ts';

export type MigrationHistory = Readonly<{
  migrationName: string;
  checksum: string;
  finishedAt: Date | null;
  rolledBackAt: Date | null;
}>;

function migrationName(entry: MigrationChecksum) {
  return entry.path.slice(0, -'/migration.sql'.length);
}

// DB履歴もmanifestと完全一致させ、未完了・rollback済み・checksum改変を成功扱いにしない。
export function verifyMigrationHistory(
  expected: readonly MigrationChecksum[],
  actual: readonly MigrationHistory[],
) {
  const expectedByName = new Map(
    expected.map((entry) => [migrationName(entry), entry.sha256]),
  );
  const actualByName = new Map<string, MigrationHistory>();
  for (const entry of actual) {
    assert.ok(
      !actualByName.has(entry.migrationName),
      `${entry.migrationName}: DB履歴が重複しています`,
    );
    actualByName.set(entry.migrationName, entry);
  }
  assert.equal(
    actualByName.size,
    expectedByName.size,
    'DBのmigration履歴件数がmanifestと一致しません',
  );
  for (const [name, checksum] of expectedByName) {
    const entry = actualByName.get(name);
    assert.ok(entry, `${name}: DB履歴にありません`);
    assert.equal(entry.checksum, checksum, `${name}: DB checksumが不一致です`);
    assert.ok(entry.finishedAt, `${name}: migrationが完了していません`);
    assert.equal(entry.rolledBackAt, null, `${name}: rollback済みです`);
  }
  for (const name of actualByName.keys())
    assert.ok(expectedByName.has(name), `${name}: manifestにないDB履歴です`);
}

async function main() {
  // migration履歴はapp roleから参照せず、明示したowner接続だけを使う。
  const directUrl = process.env.DIRECT_URL;
  assert.ok(directUrl, 'migration履歴検証にはDIRECT_URLが必要です');
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const manifestContent = await import('node:fs/promises').then(({ readFile }) =>
    readFile(
      path.join(
        root,
        'packages',
        'db',
        'prisma',
        'migrations.sha256',
      ),
      'utf8',
    ),
  );
  const expected = parseMigrationManifest(await manifestContent);
  const require = createRequire(path.join(root, 'packages', 'db', 'package.json'));
  const { PrismaClient } = require('@prisma/client') as {
    PrismaClient: new (options: {
      datasources: { db: { url: string } };
    }) => {
      $queryRawUnsafe: (query: string) => Promise<MigrationHistory[]>;
      $disconnect: () => Promise<void>;
    };
  };
  const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT migration_name AS "migrationName",
              checksum,
              finished_at AS "finishedAt",
              rolled_back_at AS "rolledBackAt"
         FROM "_prisma_migrations"
        ORDER BY migration_name`,
    );
    verifyMigrationHistory(expected, rows);
  } finally {
    await prisma.$disconnect();
  }
  console.log(`DB migration履歴 ${expected.length}件を検証しました。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
