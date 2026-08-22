import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const migrationRoot = 'packages/db/prisma/migrations/';
const migrationPathPattern =
  /^packages\/db\/prisma\/migrations\/[^/]+\/migration\.sql$/;

// baseとの差分を確認し、既存migrationの書き換えをmanifest更新で隠せないようにする。
export function assertNoExistingMigrationChanges(diff: string) {
  for (const line of diff.split('\n').filter(Boolean)) {
    const [status, ...paths] = line.split('\t');
    assert.match(
      status ?? '',
      /^[A-Z][0-9]*$/,
      `git diffの形式が不正です: ${line}`,
    );
    assert.ok(paths.length > 0, `git diffのパスがありません: ${line}`);
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

function readMigrationDiff(baseSha: string) {
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
    { encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    result.stderr || 'migration差分を取得できません',
  );
  return result.stdout;
}

async function main() {
  const baseSha = process.env.BASE_SHA;
  if (!baseSha || !/^[0-9a-f]{40}$/.test(baseSha))
    throw new Error('migration baseline検証には40桁のBASE_SHAが必要です');
  assertNoExistingMigrationChanges(readMigrationDiff(baseSha));
  console.log('既存migrationの変更がないことを検証しました。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
