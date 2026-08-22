import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertNoExistingMigrationChanges } from './verify-migration-baseline.ts';

test('新規migrationの追加だけを受け入れる', () => {
  assert.doesNotThrow(() =>
    assertNoExistingMigrationChanges(
      'A\tpackages/db/prisma/migrations/20260823100000_new/migration.sql\n',
    ),
  );
});

test('既存migrationの編集・削除・改名を拒否する', () => {
  for (const diff of [
    'M\tpackages/db/prisma/migrations/20260822090000_phase1_foundation/migration.sql\n',
    'D\tpackages/db/prisma/migrations/20260822090000_phase1_foundation/migration.sql\n',
    'R100\tpackages/db/prisma/migrations/20260822090000_phase1_foundation/migration.sql\tpackages/db/prisma/migrations/20260823100000_renamed/migration.sql\n',
  ])
    assert.throws(() => assertNoExistingMigrationChanges(diff));
});

test('migrationディレクトリ内の別ファイルを拒否する', () => {
  assert.throws(() =>
    assertNoExistingMigrationChanges(
      'A\tpackages/db/prisma/migrations/20260823100000_new/README.md\n',
    ),
  );
});
