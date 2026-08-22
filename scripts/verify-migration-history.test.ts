import assert from 'node:assert/strict';
import test from 'node:test';
import type { MigrationChecksum } from './verify-migration-checksum.ts';
import {
  type MigrationHistory,
  verifyMigrationHistory,
} from './verify-migration-history.ts';

const expected: MigrationChecksum[] = [
  { path: '001/migration.sql', sha256: 'a'.repeat(64) },
  { path: '002/migration.sql', sha256: 'b'.repeat(64) },
];

const complete: [MigrationHistory, MigrationHistory] = [
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

test('完了済みmigration履歴を受け入れる', () => {
  assert.doesNotThrow(() => verifyMigrationHistory(expected, complete));
});

test('DB checksumの改変を拒否する', () => {
  assert.throws(() =>
    verifyMigrationHistory(expected, [
      complete[0],
      { ...complete[1], checksum: 'c'.repeat(64) },
    ]),
  );
});

test('未適用・余分・順序違いの履歴を拒否する', () => {
  assert.throws(() => verifyMigrationHistory(expected, complete.slice(0, 1)));
  assert.throws(() =>
    verifyMigrationHistory(expected, [
      ...complete,
      {
        migrationName: '003',
        checksum: 'c'.repeat(64),
        finishedAt: new Date(),
        rolledBackAt: null,
      },
    ]),
  );
  assert.throws(() =>
    verifyMigrationHistory(expected, [complete[1], complete[0]]),
  );
});

test('未完了・rollback済みの履歴を拒否する', () => {
  assert.throws(() =>
    verifyMigrationHistory(expected, [
      complete[0],
      { ...complete[1], finishedAt: null },
    ]),
  );
  assert.throws(() =>
    verifyMigrationHistory(expected, [
      complete[0],
      { ...complete[1], rolledBackAt: new Date() },
    ]),
  );
});
