import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const migrationRoot = 'packages/db/prisma/migrations/';
const migrationPathPattern =
  /^packages\/db\/prisma\/migrations\/[^/]+\/migration\.sql$/;
const migrationLockPath = 'packages/db/prisma/migrations/migration_lock.toml';

// 既存migrationは編集・削除・改名を許可せず、新規migrationの追加だけを許可する。
export function assertNoExistingMigrationChanges(diff: string): void {
  for (const line of diff.split('\n').filter(Boolean)) {
    const [status, ...paths] = line.split('\t');
    assert.match(
      status ?? '',
      /^[A-Z][0-9]*$/,
      `git diffの形式が不正です: ${line}`,
    );
    assert.ok(paths.length > 0, `git diffのパスがありません: ${line}`);
    if (status === 'A' && paths.length === 1 && paths[0] === migrationLockPath)
      continue;
    for (const migrationPath of paths)
      assert.match(
        migrationPath ?? '',
        migrationPathPattern,
        `migration.sql以外の変更は許可しません: ${migrationPath}`,
      );
    assert.equal(
      status,
      'A',
      `既存migrationの変更・削除・改名は許可しません: ${line}`,
    );
  }
}

export function readMigrationDiff(baseSha: string, cwd: string): string {
  const result = spawnSync(
    'git',
    [
      'diff',
      '--name-status',
      '--find-renames',
      `${baseSha}...HEAD`,
      '--',
      migrationRoot,
    ],
    {
      cwd,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    result.stderr || 'migration差分を取得できません。',
  );
  return result.stdout;
}

export function verifyMigrationBaseline(
  baseSha: string | undefined,
  cwd: string,
  required = true,
): void {
  if (!baseSha) {
    assert.equal(
      required,
      false,
      'migration baseline検証には40桁のBASE_SHAが必要です。',
    );
    return;
  }
  assert.match(baseSha, /^[0-9a-f]{40}$/, 'BASE_SHAは40桁のSHA-1が必要です。');
  assertNoExistingMigrationChanges(readMigrationDiff(baseSha, cwd));
}

async function main(): Promise<void> {
  const baseSha = process.env.BASE_SHA;
  const root = process.cwd();
  verifyMigrationBaseline(baseSha, root, true);
  console.log('既存migrationの変更がないことを検証しました。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
