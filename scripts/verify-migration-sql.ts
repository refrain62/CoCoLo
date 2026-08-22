import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type MigrationSqlFile = Readonly<{
  path: string;
  content: string;
}>;

type SqlStatement = Readonly<{
  text: string;
}>;

type CreateTable = Readonly<{
  name: string;
  body: string;
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
  return content.replace(/\s+/g, ' ').trim();
}

function isWordCharacter(character: string | undefined) {
  return character !== undefined && /[A-Za-z0-9_$]/.test(character);
}

function dollarQuoteAt(content: string, index: number) {
  if (content[index] !== '$') return undefined;
  const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(content.slice(index));
  return match?.[0];
}

/**
 * SQLコメントだけを空白へ置き換え、文字列・識別子・関数bodyの内容は保持する。
 * コメントで危険なSQLを隠せないようにする一方、文字列内の`--`をSQLコメントと誤認しない。
 */
function stripSqlComments(content: string) {
  let result = '';
  let index = 0;

  while (index < content.length) {
    const character = content[index];
    const next = content[index + 1];

    if (character === '-' && next === '-') {
      result += ' ';
      index += 2;
      while (index < content.length && content[index] !== '\n') index += 1;
      continue;
    }

    if (character === '/' && next === '*') {
      result += ' ';
      index += 2;
      let depth = 1;
      while (index < content.length && depth > 0) {
        if (content[index] === '/' && content[index + 1] === '*') {
          depth += 1;
          index += 2;
          continue;
        }
        if (content[index] === '*' && content[index + 1] === '/') {
          depth -= 1;
          index += 2;
          continue;
        }
        index += 1;
      }
      assert.equal(depth, 0, 'SQLコメントが閉じられていません。');
      continue;
    }

    if (character === "'") {
      const start = index;
      index += 1;
      while (index < content.length) {
        if (content[index] === "'" && content[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (content[index] === "'") {
          index += 1;
          break;
        }
        index += 1;
      }
      assert.equal(content[index - 1], "'", 'SQL文字列が閉じられていません。');
      result += content.slice(start, index);
      continue;
    }

    if (character === '"') {
      const start = index;
      index += 1;
      while (index < content.length) {
        if (content[index] === '"' && content[index + 1] === '"') {
          index += 2;
          continue;
        }
        if (content[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      assert.equal(content[index - 1], '"', 'SQL識別子が閉じられていません。');
      result += content.slice(start, index);
      continue;
    }

    const dollarQuote = dollarQuoteAt(content, index);
    if (dollarQuote) {
      const end = content.indexOf(dollarQuote, index + dollarQuote.length);
      assert.notEqual(end, -1, 'ドル引用のSQL関数bodyが閉じられていません。');
      const endIndex = end + dollarQuote.length;
      result += content.slice(index, endIndex);
      index = endIndex;
      continue;
    }

    result += character;
    index += 1;
  }

  return result;
}

function splitSqlStatements(content: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let start = 0;
  let index = 0;
  let quote: "'" | '"' | undefined;

  while (index < content.length) {
    const character = content[index];
    if (quote) {
      if (character === quote && content[index + 1] === quote) {
        index += 2;
        continue;
      }
      if (character === quote) quote = undefined;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      index += 1;
      continue;
    }
    const dollarQuote = dollarQuoteAt(content, index);
    if (dollarQuote) {
      const end = content.indexOf(dollarQuote, index + dollarQuote.length);
      assert.notEqual(end, -1, 'ドル引用のSQL関数bodyが閉じられていません。');
      index = end + dollarQuote.length;
      continue;
    }
    if (character === ';') {
      const text = content.slice(start, index).trim();
      if (text) statements.push({ text });
      start = index + 1;
    }
    index += 1;
  }

  assert.equal(quote, undefined, 'SQLの引用符が閉じられていません。');
  const text = content.slice(start).trim();
  if (text) statements.push({ text });
  return statements;
}

function findMatchingParenthesis(content: string, openIndex: number) {
  assert.equal(content[openIndex], '(', '括弧の開始位置が不正です。');
  let depth = 0;
  let index = openIndex;
  let quote: "'" | '"' | undefined;

  while (index < content.length) {
    const character = content[index];
    if (quote) {
      if (character === quote && content[index + 1] === quote) {
        index += 2;
        continue;
      }
      if (character === quote) quote = undefined;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      index += 1;
      continue;
    }
    const dollarQuote = dollarQuoteAt(content, index);
    if (dollarQuote) {
      const end = content.indexOf(dollarQuote, index + dollarQuote.length);
      assert.notEqual(end, -1, 'ドル引用のSQL関数bodyが閉じられていません。');
      index = end + dollarQuote.length;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }

  assert.fail('SQLの括弧が閉じられていません。');
}

function findKeywordOutsideQuotes(content: string, keyword: string, from = 0) {
  let index = from;
  let quote: "'" | '"' | undefined;
  while (index < content.length) {
    const character = content[index];
    if (quote) {
      if (character === quote && content[index + 1] === quote) {
        index += 2;
        continue;
      }
      if (character === quote) quote = undefined;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      index += 1;
      continue;
    }
    const dollarQuote = dollarQuoteAt(content, index);
    if (dollarQuote) {
      const end = content.indexOf(dollarQuote, index + dollarQuote.length);
      assert.notEqual(end, -1, 'ドル引用のSQL関数bodyが閉じられていません。');
      index = end + dollarQuote.length;
      continue;
    }
    if (
      content.slice(index, index + keyword.length).toLowerCase() ===
        keyword.toLowerCase() &&
      !isWordCharacter(content[index - 1]) &&
      !isWordCharacter(content[index + keyword.length])
    ) {
      return index;
    }
    index += 1;
  }
  return -1;
}

function tablePattern(prefix: string, tableName: string, suffix = '') {
  // 表名はmigrationの命名規則で[a-z0-9_]だけに制限されるため、そのまま正規表現へ埋め込む。
  return new RegExp(
    `${prefix}\\s+(?:"?public"?\\.)?"?${tableName}"?\\b${suffix}`,
    'i',
  );
}

function parseCreateTable(statement: string): CreateTable | undefined {
  const match =
    /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?(?=\s|\()/i.exec(
      statement,
    );
  if (!match) return undefined;
  const prefixLength = match[0].length;
  const rest = statement.slice(prefixLength).trimStart();
  assert.ok(
    rest.startsWith('('),
    `${match[1]}: CREATE TABLEは列定義形式だけを許可します。AS/LIKEは使用できません。`,
  );
  const openIndex = statement.indexOf('(', prefixLength);
  assert.notEqual(
    openIndex,
    -1,
    `${match[1]}: CREATE TABLEの列定義がありません。`,
  );
  const closeIndex = findMatchingParenthesis(statement, openIndex);
  const body = statement.slice(openIndex + 1, closeIndex);
  const tableTail = statement.slice(closeIndex + 1);
  assert.doesNotMatch(
    tableTail,
    /\b(?:AS|LIKE|INHERITS|PARTITION\s+OF)\b/i,
    `${match[1]}: CREATE TABLEのAS/LIKE/継承定義は禁止です。`,
  );
  assert.equal(
    findKeywordOutsideQuotes(body, 'LIKE'),
    -1,
    `${match[1]}: CREATE TABLE内のLIKE定義は禁止です。`,
  );
  return { name: match[1].toLowerCase(), body };
}

function policyTableName(statement: string) {
  return /^CREATE\s+POLICY\s+"?[a-z_][a-z0-9_]*"?\s+ON\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/i
    .exec(statement)?.[1]
    ?.toLowerCase();
}

function findPolicyExpression(
  statement: string,
  firstKeyword: string,
  secondKeyword?: string,
) {
  let searchFrom = 0;
  while (true) {
    const firstIndex = findKeywordOutsideQuotes(
      statement,
      firstKeyword,
      searchFrom,
    );
    if (firstIndex === -1) return undefined;
    let openIndex = firstIndex + firstKeyword.length;
    while (/\s/.test(statement[openIndex] ?? '')) openIndex += 1;
    if (secondKeyword) {
      const secondMatch = new RegExp(`^${secondKeyword}(?=\\s|\\()`, 'i').exec(
        statement.slice(openIndex),
      );
      if (!secondMatch) {
        searchFrom = openIndex;
        continue;
      }
      openIndex += secondMatch[0].length;
      while (/\s/.test(statement[openIndex] ?? '')) openIndex += 1;
    }
    if (statement[openIndex] !== '(') {
      searchFrom = openIndex;
      continue;
    }
    const closeIndex = findMatchingParenthesis(statement, openIndex);
    return statement.slice(openIndex + 1, closeIndex);
  }
}

function assertTenantBoundary(
  file: MigrationSqlFile,
  tableName: string,
  clause: 'USING' | 'WITH CHECK',
  expression: string,
) {
  const normalized = compactSql(expression).toLowerCase();
  assert.ok(normalized, `${file.path}: ${tableName}の${clause}式が空です。`);
  assert.doesNotMatch(
    normalized,
    /\btrue\s+or\b|\bor\s+true\b|\b1\s*=\s*1\b/i,
    `${file.path}: ${tableName}の${clause}式に無条件許可の条件があります。`,
  );

  const rowColumn = tableName === 'tenants' ? 'id' : 'tenant_id';
  assert.match(
    normalized,
    new RegExp(
      `(?:\\b${rowColumn}\\b\\s*=\\s*(?:nullif\\s*\\(\\s*)?current_setting\\s*\\(\\s*'app\\.tenant_id'|current_setting\\s*\\(\\s*'app\\.tenant_id'[\\s\\S]*?\\b${rowColumn}\\b\\s*=)`,
      'i',
    ),
    `${file.path}: ${tableName}の${clause}式にtenant境界との等価条件が必要です。`,
  );
}

function assertPolicyTenantBoundary(file: MigrationSqlFile, statement: string) {
  const tableName = policyTableName(statement);
  assert.ok(
    tableName,
    `${file.path}: CREATE POLICYの対象tableを解釈できません。`,
  );
  const command =
    /\bFOR\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\b/i
      .exec(statement)?.[1]
      ?.toUpperCase() ?? 'ALL';
  const using = findPolicyExpression(statement, 'USING');
  const withCheck = findPolicyExpression(statement, 'WITH', 'CHECK');
  if (command !== 'INSERT') {
    assert.ok(
      using !== undefined,
      `${file.path}: ${tableName}の${command} policyにはUSINGが必要です。`,
    );
    assertTenantBoundary(file, tableName, 'USING', using ?? '');
  }
  if (command === 'INSERT' || command === 'UPDATE' || command === 'ALL') {
    assert.ok(
      withCheck !== undefined,
      `${file.path}: ${tableName}の${command} policyにはWITH CHECKが必要です。`,
    );
    assertTenantBoundary(file, tableName, 'WITH CHECK', withCheck ?? '');
  }
}

function assertGrantTarget(file: MigrationSqlFile, statement: string) {
  assert.doesNotMatch(
    statement,
    /\bWITH\s+GRANT\s+OPTION\b/i,
    `${file.path}: GRANT OPTIONは禁止です。`,
  );
  const toMatch = /\bTO\s+(.+)$/i.exec(statement);
  assert.ok(toMatch, `${file.path}: GRANTの付与先を解釈できません。`);
  assert.match(
    toMatch?.[1] ?? '',
    /^"?cocolo_app"?$/i,
    `${file.path}: cocolo_app以外・PUBLIC・複数granteeへのGRANTは禁止です。`,
  );
}

function assertAllowedStatement(file: MigrationSqlFile, statement: string) {
  const compact = compactSql(statement);
  assert.doesNotMatch(
    compact,
    /\b(?:SECURITY\s+DEFINER|CREATE\s+(?:OR\s+REPLACE\s+)?VIEW|CREATE\s+MATERIALIZED\s+VIEW|SET\s+(?:LOCAL\s+)?row_security\s*=\s*off|ALTER\s+TABLE\b[^;]*\b(?:DROP\s+CONSTRAINT|DISABLE\s+TRIGGER|DROP\s+COLUMN|NO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY|DISABLE\s+ROW\s+LEVEL\s+SECURITY)|\b(?:CREATE|ALTER|DROP)\s+ROLE\b|\bDROP\s+(?:TABLE|SCHEMA|DATABASE|SEQUENCE|TYPE|VIEW|FUNCTION)|\b(?:TRUNCATE|DELETE\s+FROM|REVOKE)\b)/i,
    `${file.path}: 危険なDDLまたは権限操作は禁止です。`,
  );

  if (/^GRANT\b/i.test(compact)) {
    assertGrantTarget(file, compact);
    return;
  }
  if (/^CREATE\s+TABLE\b/i.test(compact)) {
    parseCreateTable(compact);
    return;
  }
  if (/^CREATE\s+POLICY\b/i.test(compact)) {
    assertPolicyTenantBoundary(file, compact);
    return;
  }
  if (/^DROP\s+(?:POLICY|TRIGGER)\b/i.test(compact)) return;
  if (/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i.test(compact)) return;
  if (/^CREATE\s+TRIGGER\b/i.test(compact)) return;
  if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(compact)) return;
  if (/^CREATE\s+TYPE\b/i.test(compact)) {
    assert.match(compact, /^CREATE\s+TYPE\b.+\bAS\s+ENUM\s*\(/i);
    return;
  }
  if (/^ALTER\s+TYPE\b/i.test(compact)) {
    assert.match(compact, /^ALTER\s+TYPE\b.+\bADD\s+VALUE\b/i);
    return;
  }
  if (/^COMMENT\s+ON\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)\b/i.test(compact))
    return;
  if (/^ALTER\s+TABLE\b/i.test(compact)) {
    assert.match(
      compact,
      /^ALTER\s+TABLE\b.+\b(?:ENABLE\s+ROW\s+LEVEL\s+SECURITY|FORCE\s+ROW\s+LEVEL\s+SECURITY|ADD\s+(?:COLUMN|CONSTRAINT)\b)/i,
      `${file.path}: 許可されていないALTER TABLEです。`,
    );
    return;
  }

  assert.fail(`${file.path}: 未許可のSQL文です。fail-closedで拒否しました。`);
}

function assertCreatedTablesAreProtected(
  file: MigrationSqlFile,
  statements: readonly SqlStatement[],
) {
  const createTables = statements
    .map((statement) => parseCreateTable(statement.text))
    .filter((table): table is CreateTable => table !== undefined);

  for (const table of createTables) {
    const tableName = table.name;
    if (tableName !== 'tenants') {
      assert.ok(
        /(?:^|,)\s*"?tenant_id"?\s+[a-z_]/i.test(table.body),
        `${file.path}: ${tableName}にはtenant_id列が必要です。`,
      );
    }
    assert.ok(
      statements.some((statement) =>
        new RegExp(
          `^COMMENT\\s+ON\\s+TABLE\\s+(?:"?public"?\\.)?"?${tableName}"?\\b`,
          'i',
        ).test(compactSql(statement.text)),
      ),
      `${file.path}: ${tableName}のCOMMENTが必要です。`,
    );
    assert.ok(
      statements.some((statement) =>
        tablePattern(
          'ALTER\\s+TABLE',
          tableName,
          '\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY',
        ).test(compactSql(statement.text)),
      ),
      `${file.path}: ${tableName}のRLS ENABLEが必要です。`,
    );
    assert.ok(
      statements.some((statement) =>
        tablePattern(
          'ALTER\\s+TABLE',
          tableName,
          '\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY',
        ).test(compactSql(statement.text)),
      ),
      `${file.path}: ${tableName}のRLS FORCEが必要です。`,
    );
    assert.ok(
      statements.some((statement) => {
        const text = compactSql(statement.text);
        return (
          /^CREATE\s+POLICY\b/i.test(text) &&
          new RegExp(
            `\\bON\\s+(?:"?public"?\\.)?"?${tableName}"?\\b`,
            'i',
          ).test(text)
        );
      }),
      `${file.path}: ${tableName}のRLS policyが必要です。`,
    );
    assert.ok(
      statements.some((statement) => {
        const text = compactSql(statement.text);
        return (
          /^GRANT\b/i.test(text) &&
          new RegExp(
            `\\bON\\s+(?:TABLE\\s+)?[^;]*\\b${tableName}\\b[^;]*\\bTO\\s+cocolo_app\\b`,
            'i',
          ).test(text)
        );
      }),
      `${file.path}: ${tableName}へのcocolo_app権限が必要です。`,
    );
  }
}

function statementsForFile(file: MigrationSqlFile) {
  return splitSqlStatements(stripSqlComments(file.content));
}

// migration単位で危険なSQLと新規テーブルのRLS・tenant境界を検査し、別migrationの安全な記述で隠せないようにする。
export function validateMigrationSql(files: readonly MigrationSqlFile[]) {
  assert.ok(files.length > 0, 'migration.sqlが1件以上必要です。');
  const allStatements: SqlStatement[] = [];
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
    const statements = statementsForFile(file);
    assert.ok(statements.length > 0, `${file.path}: SQL文がありません。`);
    for (const statement of statements) {
      assertAllowedStatement(file, statement.text);
      allStatements.push(statement);
    }
    assertCreatedTablesAreProtected(file, statements);
  }

  assert.ok(
    allStatements.some((statement) =>
      /^COMMENT\s+ON\s+TABLE\b/i.test(statement.text),
    ),
    'COMMENT ON TABLEが1件以上必要です。',
  );
  assert.ok(
    allStatements.some((statement) =>
      /^ALTER\s+TABLE\b.+\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(
        compactSql(statement.text),
      ),
    ),
    'RLS ENABLEが1件以上必要です。',
  );
  assert.ok(
    allStatements.some((statement) =>
      /^ALTER\s+TABLE\b.+\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(
        compactSql(statement.text),
      ),
    ),
    'RLS FORCEが1件以上必要です。',
  );
  assert.ok(
    allStatements.some((statement) =>
      /^GRANT\b.+\bTO\s+cocolo_app\b/i.test(statement.text),
    ),
    'cocolo_appへのGRANTが1件以上必要です。',
  );
  assert.ok(
    allStatements.some((statement) =>
      /\bFOREIGN\s+KEY\s*\([^)]*tenant_id[^)]*\)/i.test(statement.text),
    ),
    'tenant_idの外部キーが1件以上必要です。',
  );
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
