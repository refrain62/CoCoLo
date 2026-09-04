import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
    for (const migrationPath of paths) {
      if (migrationPath === `${migrationRoot}migration_lock.toml`) {
        assert.equal(
          status,
          'A',
          `既存migration lockfileの変更・削除・改名は許可しません: ${line}`,
        );
        continue;
      }
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
}

function readMigrationDiff(baseSha: string, cwd = process.cwd()) {
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
    { cwd, encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    result.stderr || 'migration差分を取得できません',
  );
  return result.stdout;
}

export function verifyMigrationBaseline(
  baseSha = process.env.BASE_SHA,
  rootDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  ci = process.env.CI === 'true',
): void {
  if (!ci) return;
  assert.ok(
    baseSha && /^[0-9a-f]{40}$/.test(baseSha),
    'migration baseline検証には40桁のBASE_SHAが必要です',
  );
  assertNoExistingMigrationChanges(readMigrationDiff(baseSha, rootDirectory));
}

async function main() {
  verifyMigrationBaseline(process.env.BASE_SHA, undefined, true);
  console.log('既存migrationの変更がないことを検証しました。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
