import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const migrationsRoot = path.join(
  root,
  'packages',
  'db',
  'prisma',
  'migrations',
);
const migrations = await readdir(migrationsRoot, { withFileTypes: true }).catch(
  () => [],
);
const sqlFiles = migrations
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(migrationsRoot, entry.name, 'migration.sql'));
assert.ok(sqlFiles.length > 0, 'migration.sql が1件以上必要です');

const sqlContents = [];
for (const file of sqlFiles) {
  const bytes = await readFile(file);
  assert.notEqual(bytes[0], 0xef, `${file} はBOMなしUTF-8にしてください`);
  const sql = bytes.toString('utf8');
  assert.ok(!sql.includes('\r'), `${file} はLF改行にしてください`);
  sqlContents.push(sql);
}
const allSql = sqlContents.join('\n');
assert.match(allSql, /COMMENT ON TABLE\s+[a-z_]+/);
assert.match(allSql, /ALTER TABLE\s+[a-z_]+\s+ENABLE ROW LEVEL SECURITY/);
assert.match(allSql, /ALTER TABLE\s+[a-z_]+\s+FORCE ROW LEVEL SECURITY/);
assert.match(allSql, /GRANT\s+.*\s+TO\s+cocolo_app/);
assert.match(allSql, /FOREIGN KEY\s*\([^)]*tenant_id[^)]*\)/i);
console.log(`migration SQL ${sqlFiles.length}件を検証しました。`);
