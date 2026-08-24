import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertNoExistingMigrationChanges,
  verifyMigrationBaseline,
} from './verify-migration-baseline.ts';
import {
  formatMigrationManifest,
  verifyMigrationManifest,
} from './verify-migration-checksum.ts';
import { assertSchemaDriftWorkflowConnected } from './verify-schema-drift.ts';

const migration = {
  path: '20260823000000_fixture/migration.sql',
  sha256: 'a'.repeat(64),
} as const;

test('checksum変更をmanifestの悪性fixtureとして拒否する', () => {
  const changed = { ...migration, sha256: 'b'.repeat(64) };
  assert.throws(
    () =>
      verifyMigrationManifest([migration], formatMigrationManifest([changed])),
    /checksumが一致しません/,
  );
});

test('既存migrationの変更・削除・改名をbaselineで拒否する', () => {
  for (const diff of [
    'M\tpackages/db/prisma/migrations/20260822090000_phase1_foundation/migration.sql',
    'D\tpackages/db/prisma/migrations/20260822090000_phase1_foundation/migration.sql',
    'R100\tpackages/db/prisma/migrations/20260822090000_phase1_foundation/migration.sql\tpackages/db/prisma/migrations/20260823000000_renamed/migration.sql',
  ]) {
    assert.throws(() => assertNoExistingMigrationChanges(diff), /許可しません/);
  }
  assert.doesNotThrow(() =>
    assertNoExistingMigrationChanges(
      'A\tpackages/db/prisma/migrations/20260823000000_new/migration.sql',
    ),
  );
  assert.doesNotThrow(() =>
    assertNoExistingMigrationChanges(
      'A\tpackages/db/prisma/migrations/migration_lock.toml',
    ),
  );
  assert.throws(
    () =>
      assertNoExistingMigrationChanges(
        'M\tpackages/db/prisma/migrations/migration_lock.toml',
      ),
    /lockfile/,
  );
});

test('CIのBASE_SHA欠落をfail-closedにする', () => {
  assert.throws(
    () => verifyMigrationBaseline('', 'C:\\repo', true),
    /40桁のBASE_SHA/,
  );
  assert.doesNotThrow(() =>
    verifyMigrationBaseline(undefined, 'C:\\repo', false),
  );
});

test('schema drift検査がCIへ接続されていないfixtureを拒否する', () => {
  const disconnected =
    'on:\n  pull_request:\n  push:\n    branches: [main]\njobs:\n  check:\n    steps:\n      - run: pnpm test:schema-drift\n';
  assert.throws(
    () => assertSchemaDriftWorkflowConnected(disconnected),
    /verify:schema-drift/,
  );
  const disabled = `
on:
  pull_request:
  push:
    branches: [main]
jobs:
  check:
    steps:
      - name: schema drift
        if: false
        run: pnpm verify:schema-drift
        env:
          BASE_SHA: \${{ github.event.pull_request.base.sha || github.event.before }}
          CI: true
          APP_ENV: local
`;
  assert.throws(() => assertSchemaDriftWorkflowConnected(disabled), /無効化/);
});
