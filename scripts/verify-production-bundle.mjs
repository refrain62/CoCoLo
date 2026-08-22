import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const forbidden = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'test-only Auth',
  'TEST_ONLY_AUTH',
];
const roots = [
  path.join(root, 'apps', 'web', 'dist'),
  path.join(root, 'apps', 'api', 'dist'),
];
let scanned = 0;
async function scan(directory) {
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
assert.ok(scanned > 0, 'production bundleが見つかりません');
console.log(`production bundle ${scanned}ファイルを検証しました。`);
