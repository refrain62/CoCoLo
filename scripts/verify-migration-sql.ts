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
      pattern: /\b(?:TRUNCATE|DELETE\s+FROM)\b/i,
      message: '既存データを一括削除するSQLは禁止です。',
    },
  ] as const;

  for (const rule of forbiddenStatements) {
    assert.doesNotMatch(compact, rule.pattern, `${file.path}: ${rule.message}`);
  }

  const grantPattern = /\bGRANT\b[^;]*;/gi;
  for (const match of compact.matchAll(grantPattern)) {
    const grantees =
      /\bTO\s+(.+?)(?:\s+WITH\s+GRANT\s+OPTION)?\s*;/i
        .exec(match[0])?.[1]
        ?.split(',')
        .map((grantee) => grantee.trim().toLowerCase()) ?? [];
    assert.ok(grantees.length > 0, `${file.path}: GRANT先を解釈できません。`);
    for (const grantee of grantees)
      assert.ok(
        grantee === 'cocolo_app' ||
          grantee === 'line_delivery_worker' ||
          grantee === 'line_webhook_receiver',
        `${file.path}: 許可された実行role以外へのGRANTは禁止です。`,
      );
    assert.doesNotMatch(
      match[0],
      /\bWITH\s+GRANT\s+OPTION\b/i,
      `${file.path}: GRANT OPTIONは禁止です。`,
    );
  }

  const revokePattern = /\bREVOKE\b[^;]*;/gi;
  for (const match of compact.matchAll(revokePattern))
    assert.match(
      match[0],
      /^REVOKE\s+.+\s+ON\s+(?:TABLE\s+)?[^;]+\s+FROM\s+(?:PUBLIC|cocolo_app|line_delivery_worker|line_webhook_receiver)(?:\s*,\s*(?:PUBLIC|cocolo_app|line_delivery_worker|line_webhook_receiver))*\s*;$/i,
      `${file.path}: 許可されたrole以外へのREVOKEは禁止です。`,
    );
}

function assertCreatedTablesAreProtected(file: MigrationSqlFile) {
  const compact = compactSql(file.content);
  const globalTenantIndependentTables = new Set(['feature_definitions']);
  const createTablePattern =
    /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;

  for (const match of compact.matchAll(createTablePattern)) {
    const tableName = match[1];
    assert.ok(tableName, `${file.path}: CREATE TABLEの名前を解釈できません。`);
    const tableStart = match.index ?? 0;
    const nextTableMatch = /\bCREATE\s+TABLE\b/i.exec(
      compact.slice(tableStart + match[0].length),
    );
    const nextTable =
      nextTableMatch?.index === undefined
        ? -1
        : tableStart + match[0].length + nextTableMatch.index;
    const tableBody = compact.slice(
      tableStart,
      nextTable === -1 ? compact.length : nextTable,
    );
    if (
      tableName !== 'tenants' &&
      !globalTenantIndependentTables.has(tableName)
    )
      assert.match(
        tableBody,
        /\btenant_id\b/i,
        `${file.path}: ${tableName}にはtenant_id列が必要です。`,
      );
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
    if (tableName !== 'line_delivery_outbox')
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

function assertPolicyTenantBoundaries(file: MigrationSqlFile) {
  const compact = compactSql(file.content);
  const policyPattern = /\bCREATE\s+POLICY\b[^;]+;/gi;
  for (const match of compact.matchAll(policyPattern)) {
    const statement = match[0];
    const table = /\bON\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/i.exec(
      statement,
    )?.[1];
    assert.ok(table, `${file.path}: policyの対象tableを解釈できません。`);
    if (table === 'tenants') {
      assert.match(
        statement,
        /\bid\b[\s\S]*current_setting\s*\(\s*'app\.tenant_id'/i,
        `${file.path}: tenants policyにtenant境界が必要です。`,
      );
      continue;
    }
    if (table === 'feature_definitions') {
      assert.match(
        statement,
        /current_setting\s*\(\s*'app\.tenant_id'|app_has_active_membership/i,
        `${file.path}: ${table} policyにtenant context境界が必要です。`,
      );
      continue;
    }
    assert.match(
      statement,
      /\btenant_id\b/i,
      `${file.path}: ${table} policyにtenant_id境界が必要です。`,
    );
    assert.match(
      statement,
      /current_setting\s*\(\s*'app\.tenant_id'|app_has_active_membership/i,
      `${file.path}: ${table} policyにtenant context境界が必要です。`,
    );
    assert.match(
      statement,
      /(?:\b(?:tenant_id|id)\s*=\s*(?:\(*\s*)?(?:nullif\s*\(\s*)?current_setting\s*\(\s*'app\.tenant_id'(?:\s*::\w+)?|current_setting\s*\(\s*'app\.tenant_id'(?:\s*::\w+)?[^)]*\)\s*\)?\s*::?\w*\s*=\s*(?:tenant_id|id)|app_has_active_membership\s*\(\s*tenant_id\s*\))/i,
      `${file.path}: ${table} policyにtenant contextとの実際の一致またはmembership検証が必要です。`,
    );
    assert.doesNotMatch(
      statement,
      /\b(?:USING|WITH\s+CHECK)\s*\(\s*true\s*\)/i,
      `${file.path}: ${table} policyの無条件許可は禁止です。`,
    );
    assert.doesNotMatch(
      statement,
      /\b(?:OR|AND)\s+true\b|\btrue\s+(?:OR|AND)\b|\b(?:tenant_id|id)\s+IS\s+(?:NOT\s+)?NULL\b/i,
      `${file.path}: ${table} policyのtrueによる境界無効化は禁止です。`,
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
    assertPolicyTenantBoundaries(file);
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
