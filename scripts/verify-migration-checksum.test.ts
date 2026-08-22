import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatMigrationManifest,
  parseMigrationManifest,
  verifyMigrationManifest,
  type MigrationChecksum,
} from './verify-migration-checksum.ts';

const entries: MigrationChecksum[] = [
  {
    path: '20260822100000_phase1_member_rls_hardening/migration.sql',
    sha256: 'b'.repeat(64),
  },
  {
    path: '20260822090000_phase1_foundation/migration.sql',
    sha256: 'a'.repeat(64),
  },
];

test('migration checksumはパス順に正規化される', () => {
  assert.equal(
    formatMigrationManifest(entries),
    `${'a'.repeat(64)}  20260822090000_phase1_foundation/migration.sql\n${'b'.repeat(64)}  20260822100000_phase1_member_rls_hardening/migration.sql\n`,
  );
});

test('migration checksumの正本と実ファイル一覧が一致する', () => {
  assert.doesNotThrow(() =>
    verifyMigrationManifest(entries, formatMigrationManifest(entries)),
  );
});

test('migrationの編集をchecksum不一致として拒否する', () => {
  const changed = entries.map((entry, index) =>
    index === 0 ? { ...entry, sha256: 'c'.repeat(64) } : entry,
  );
  assert.throws(() =>
    verifyMigrationManifest(changed, formatMigrationManifest(entries)),
  );
});

test('migrationの追加と削除をchecksum不一致として拒否する', () => {
  const added = [
    ...entries,
    {
      path: '20260822120000_promotion_state_guard/migration.sql',
      sha256: 'c'.repeat(64),
    },
  ];
  assert.throws(() =>
    verifyMigrationManifest(added, formatMigrationManifest(entries)),
  );
  assert.throws(() =>
    verifyMigrationManifest(entries.slice(0, 1), formatMigrationManifest(entries)),
  );
});

test('不正なmanifest形式を拒否する', () => {
  assert.throws(() => parseMigrationManifest(`${'a'.repeat(64)} migration.sql\n`));
  assert.throws(() =>
    parseMigrationManifest(
      `${'a'.repeat(64)}  20260822090000_phase1_foundation/migration.sql\r\n`,
    ),
  );
});
