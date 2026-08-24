import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withPostgresClient } from './postgres-client.ts';

export type UuidColumn = Readonly<{
  tableName: string;
  columnName: string;
}>;

export type UuidVersionFinding = Readonly<
  UuidColumn & { invalidCount: number }
>;

// provider retry keyと送信lease tokenは外部再送・競合制御用のUUIDv4であり、業務IDの移行対象外とする。
export const uuidV4AllowedColumns = new Set([
  'line_delivery_outbox.attempt_token',
  'line_delivery_outbox.provider_retry_key',
]);

export function isUuidV7Column(column: UuidColumn): boolean {
  return !uuidV4AllowedColumns.has(`${column.tableName}.${column.columnName}`);
}

function quoteIdentifier(identifier: string): string {
  assert.match(
    identifier,
    /^[a-z_][a-z0-9_]*$/,
    `PostgreSQL識別子が不正です: ${identifier}`,
  );
  return `"${identifier}"`;
}

export function buildInvalidUuidV7Query(column: UuidColumn): string {
  const tableName = quoteIdentifier(column.tableName);
  const columnName = quoteIdentifier(column.columnName);
  return `SELECT count(*)::integer AS "invalidCount"
    FROM ${tableName}
   WHERE ${columnName} IS NOT NULL
     AND substring(${columnName}::text, 15, 1) <> '7'`;
}

type ColumnRow = Readonly<{
  tableName: string;
  columnName: string;
}>;

type CountRow = Readonly<{ invalidCount: number }>;

async function readUuidColumns(
  client: Parameters<Parameters<typeof withPostgresClient>[1]>[0],
): Promise<UuidColumn[]> {
  const rows = await client.$queryRawUnsafe<readonly ColumnRow[]>(`
    SELECT c.table_name AS "tableName", c.column_name AS "columnName"
      FROM information_schema.columns AS c
      JOIN information_schema.tables AS t
        ON t.table_schema = c.table_schema
       AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.udt_name = 'uuid'
       AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_name, c.ordinal_position
  `);
  assert.ok(Array.isArray(rows), 'UUID列一覧の応答が不正です。');
  return rows.map((row) => ({
    tableName: row.tableName,
    columnName: row.columnName,
  }));
}

export async function findInvalidUuidV7Rows(
  databaseUrl = process.env.DIRECT_URL,
): Promise<UuidVersionFinding[]> {
  assert.ok(databaseUrl, 'DIRECT_URLが必要です。');
  return withPostgresClient(databaseUrl, async (client) => {
    const columns = (await readUuidColumns(client)).filter(isUuidV7Column);
    const findings: UuidVersionFinding[] = [];
    for (const column of columns) {
      const rows = await client.$queryRawUnsafe<readonly CountRow[]>(
        buildInvalidUuidV7Query(column),
      );
      const invalidCount = Number(rows[0]?.invalidCount);
      assert.ok(
        Number.isSafeInteger(invalidCount) && invalidCount >= 0,
        `${column.tableName}.${column.columnName}: UUID不正件数の応答が不正です。`,
      );
      if (invalidCount > 0) findings.push({ ...column, invalidCount });
    }
    return findings;
  });
}

async function main(): Promise<void> {
  const findings = await findInvalidUuidV7Rows();
  assert.equal(
    findings.length,
    0,
    `UUIDv7移行前検査に失敗しました: ${findings
      .map(
        (finding) =>
          `${finding.tableName}.${finding.columnName}=${finding.invalidCount}件`,
      )
      .join(', ')}`,
  );
  console.log('既存UUID列のUUIDv7移行前検査が完了しました。');
}

const scriptPath = path.resolve(process.argv[1] ?? '');
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(scriptPath).href &&
  fileURLToPath(import.meta.url) === scriptPath
)
  await main();
