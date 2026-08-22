import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type MigrationSqlFile = Readonly<{
  path: string;
  content: string;
}>;

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const migrationsRoot = path.join(
  root,
  'packages',
  'db',
  'prisma',
  'migrations',
);

function compactSql(content: string) {
  return content.replace(/\s+/g, ' ');
}

function tablePattern(prefix: string, tableName: string, suffix = '') {
  // 表名はmigrationの命名規則で[a-z0-9_]だけに制限されるため、そのまま正規表現へ埋め込む。
  return new RegExp(
    `${prefix}\\s+(?:"?public"?\\.)?"?${tableName}"?\\b${suffix}`,
    'i',
  );
}

function assertForbiddenStatements(file: MigrationSqlFile) {
  const compact = compactSql(file.content);
  const forbiddenStatements = [
    {
      pattern: /\bALTER\s+TABLE\b[^;]*\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i,
      message: 'RLSを無効化するSQLは禁止です。',
    },
    {
      pattern: /\bALTER\s+TABLE\b[^;]*\bNO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY\b/i,
      message: 'RLSの強制適用を解除するSQLは禁止です。',
    },
    {
      pattern: /\b(?:CREATE|ALTER|DROP)\s+ROLE\b/i,
      message: 'migration内のrole変更は禁止です。',
    },
    {
      pattern: /\bDROP\s+(?:TABLE|SCHEMA|DATABASE|SEQUENCE|TYPE)\b/i,
      message: '既存データまたは共有定義を削除するSQLは禁止です。',
    },
    {
      pattern: /\bALTER\s+TABLE\b[^;]*\bDROP\s+COLUMN\b/i,
      message: '既存列を削除するSQLは禁止です。',
    },
    {
      pattern: /\b(?:TRUNCATE|DELETE\s+FROM|REVOKE)\b/i,
      message: '既存データまたは権限を一括削除するSQLは禁止です。',
    },
  ] as const;

  for (const rule of forbiddenStatements) {
    assert.doesNotMatch(compact, rule.pattern, `${file.path}: ${rule.message}`);
  }

  const grantPattern = /\bGRANT\b[^;]*;/gi;
  for (const match of compact.matchAll(grantPattern)) {
    const grantee = /\bTO\s+([a-z_][a-z0-9_]*)\b/i
      .exec(match[0])?.[1]
      ?.toLowerCase();
    assert.equal(
      grantee,
      'cocolo_app',
      `${file.path}: cocolo_app以外へのGRANTは禁止です。`,
    );
    assert.doesNotMatch(
      match[0],
      /\bWITH\s+GRANT\s+OPTION\b/i,
      `${file.path}: GRANT OPTIONは禁止です。`,
    );
  }
}

function assertCreatedTablesAreProtected(file: MigrationSqlFile) {
  const compact = compactSql(file.content);
  const createTablePattern =
    /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;

  for (const match of compact.matchAll(createTablePattern)) {
    const tableName = match[1];
    assert.ok(tableName, `${file.path}: CREATE TABLEの名前を解釈できません。`);
    assert.match(
      compact,
      tablePattern('COMMENT\\s+ON\\s+TABLE', tableName),
      `${file.path}: ${tableName}のCOMMENTが必要です。`,
    );
    assert.match(
      compact,
      tablePattern(
        'ALTER\\s+TABLE',
        tableName,
        '\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY',
      ),
      `${file.path}: ${tableName}のRLS ENABLEが必要です。`,
    );
    assert.match(
      compact,
      tablePattern(
        'ALTER\\s+TABLE',
        tableName,
        '\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY',
      ),
      `${file.path}: ${tableName}のRLS FORCEが必要です。`,
    );
    assert.match(
      compact,
      tablePattern('CREATE\\s+POLICY\\s+[^;]+\\bON', tableName),
      `${file.path}: ${tableName}のRLS policyが必要です。`,
    );
    assert.match(
      compact,
      new RegExp(
        `GRANT\\s+[^;]*\\b${tableName}\\b[^;]*\\bTO\\s+cocolo_app\\b`,
        'i',
      ),
      `${file.path}: ${tableName}へのcocolo_app権限が必要です。`,
    );
  }
}

// migration単位で危険なSQLと新規テーブルのRLS保護を検査し、別migrationの安全な記述で隠せないようにする。
export function validateMigrationSql(files: readonly MigrationSqlFile[]) {
  assert.ok(files.length > 0, 'migration.sqlが1件以上必要です。');
  for (const file of files) {
    const bytes = Buffer.from(file.content, 'utf8');
    assert.notEqual(
      bytes[0],
      0xef,
      `${file.path}はBOMなしUTF-8にしてください。`,
    );
    assert.ok(
      !file.content.includes('\r'),
      `${file.path}はLF改行にしてください。`,
    );
    assertForbiddenStatements(file);
    assertCreatedTablesAreProtected(file);
  }
  const allSql = files.map((file) => file.content).join('\n');
  assert.match(allSql, /COMMENT ON TABLE\s+[a-z_]+/);
  assert.match(allSql, /ALTER TABLE\s+[a-z_]+\s+ENABLE ROW LEVEL SECURITY/);
  assert.match(allSql, /ALTER TABLE\s+[a-z_]+\s+FORCE ROW LEVEL SECURITY/);
  assert.match(allSql, /GRANT\s+.*\s+TO\s+cocolo_app/);
  assert.match(allSql, /FOREIGN KEY\s*\([^)]*tenant_id[^)]*\)/i);
}

async function readMigrationFiles() {
  const directories = await readdir(migrationsRoot, { withFileTypes: true });
  const migrationDirectories = directories
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const files: MigrationSqlFile[] = [];
  for (const directory of migrationDirectories) {
    const relativePath = `${directory.name}/migration.sql`;
    files.push({
      path: relativePath,
      content: await readFile(path.join(migrationsRoot, relativePath), 'utf8'),
    });
  }
  return files;
}

async function main() {
  const files = await readMigrationFiles();
  validateMigrationSql(files);
  console.log(`マイグレーション SQL ${files.length} 件を検証しました。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
