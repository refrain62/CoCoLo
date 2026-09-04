import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MigrationChecksum } from './verify-migration-checksum.ts';
import {
  type MigrationHistory,
  verifyMigrationHistory,
} from './verify-migration-history.ts';

const expected: MigrationChecksum[] = [
  { path: '001/migration.sql', sha256: 'a'.repeat(64) },
  { path: '002/migration.sql', sha256: 'b'.repeat(64) },
];

const completeHistory: MigrationHistory[] = [
  {
    migrationName: '001',
    checksum: 'a'.repeat(64),
    finishedAt: new Date('2026-08-23T00:00:00Z'),
    rolledBackAt: null,
  },
  {
    migrationName: '002',
    checksum: 'b'.repeat(64),
    finishedAt: new Date('2026-08-23T00:01:00Z'),
    rolledBackAt: null,
  },
];
const firstHistory = completeHistory[0];
const secondHistory = completeHistory[1];
assert.ok(firstHistory);
assert.ok(secondHistory);

test('完了済みmigration履歴を受け入れる', () => {
  assert.doesNotThrow(() => verifyMigrationHistory(expected, completeHistory));
});

test('DB checksumの改変を拒否する', () => {
  const changed = completeHistory.map((entry) =>
    entry.migrationName === '002'
      ? { ...entry, checksum: 'c'.repeat(64) }
      : entry,
  );
  assert.throws(() => verifyMigrationHistory(expected, changed));
});

test('未完了とrollback済みの履歴を拒否する', () => {
  assert.throws(() =>
    verifyMigrationHistory(expected, [
      firstHistory,
      { ...secondHistory, finishedAt: null },
    ]),
  );
  assert.throws(() =>
    verifyMigrationHistory(expected, [
      firstHistory,
      { ...secondHistory, rolledBackAt: new Date() },
    ]),
  );
});

test('DB履歴の追加・削除を拒否する', () => {
  assert.throws(() =>
    verifyMigrationHistory(expected, completeHistory.slice(0, 1)),
  );
  assert.throws(() =>
    verifyMigrationHistory(expected, [
      ...completeHistory,
      {
        migrationName: '003',
        checksum: 'c'.repeat(64),
        finishedAt: new Date(),
        rolledBackAt: null,
      },
    ]),
  );
});
