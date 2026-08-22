import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 配置前bundleを走査し、Service Role Keyやlocal test-only Authの識別子が公開成果物へ混入していないことを確認する。
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const forbidden = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'test-only Auth',
  'TEST_ONLY_AUTH',
  'local-test-owner-token',
  'owner-password',
];
const roots = [
  path.join(root, 'apps', 'web', 'dist'),
  path.join(root, 'apps', 'api', 'dist'),
];
let scanned = 0;
// dist配下を再帰走査し、禁止文字列を見つけた時点でreleaseを不合格にする。
async function scan(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await scan(file);
    else {
      scanned += 1;
      const content = await readFile(file, 'utf8');
      for (const token of forbidden)
        assert.ok(
          !content.includes(token),
          `${file} に禁止文字列 ${token} が含まれています`,
        );
    }
  }
}
for (const directory of roots) await scan(directory);
assert.ok(scanned > 0, '本番用バンドルが見つかりません。');
console.log(`本番用バンドル ${scanned} ファイルを検証しました。`);
