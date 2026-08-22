import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type SchemaDriftPaths = Readonly<{
  dbDirectory: string;
  schemaFile: string;
  migrationsDirectory: string;
  migrationLockFile: string;
}>;

export type PrismaDiffResult = Readonly<{
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: Error;
}>;

export type PrismaDiffOptions = Readonly<{
  cwd: string;
  encoding: 'utf8';
  shell: boolean;
  windowsHide: boolean;
}>;

export type PrismaDiffRunner = (
  command: string,
  args: readonly string[],
  options: PrismaDiffOptions,
) => PrismaDiffResult;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(scriptDirectory);

export function resolveSchemaDriftPaths(
  root = repositoryRoot,
): SchemaDriftPaths {
  const dbDirectory = path.join(root, 'packages', 'db');
  const prismaDirectory = path.join(dbDirectory, 'prisma');
  const migrationsDirectory = path.join(prismaDirectory, 'migrations');
  return {
    dbDirectory,
    schemaFile: path.join(prismaDirectory, 'schema.prisma'),
    migrationsDirectory,
    migrationLockFile: path.join(migrationsDirectory, 'migration_lock.toml'),
  };
}

export function buildPrismaDiffArgs(
  paths: SchemaDriftPaths,
  shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL,
): readonly string[] {
  assert.ok(
    shadowDatabaseUrl,
    'schema drift検査には専用のSHADOW_DATABASE_URLが必要です。',
  );
  return [
    'migrate',
    'diff',
    '--from-migrations',
    paths.migrationsDirectory,
    '--to-schema-datamodel',
    paths.schemaFile,
    '--shadow-database-url',
    shadowDatabaseUrl,
    '--script',
    '--exit-code',
  ];
}

function outputText(value: string | Buffer | null | undefined): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return value.toString('utf8');
}

export function runPrismaDiff(
  command: string,
  args: readonly string[],
  options: PrismaDiffOptions,
): PrismaDiffResult {
  const result = spawnSync(command, args, options);
  return {
    status: result.status,
    signal: result.signal,
    stdout: outputText(result.stdout),
    stderr: outputText(result.stderr),
    ...(result.error ? { error: result.error } : {}),
  };
}

export function assertMigrationLock(content: string): void {
  assert.ok(content.length > 0, 'migration_lock.toml が空です。');
  assert.ok(
    !content.startsWith('\uFEFF'),
    'migration_lock.toml はBOMなしUTF-8にしてください。',
  );
  assert.ok(
    !content.includes('\r'),
    'migration_lock.toml はLF改行にしてください。',
  );

  const providerMatches = [
    ...content.matchAll(/^\s*provider\s*=\s*"([^"\r\n]+)"\s*$/gm),
  ];
  assert.equal(
    providerMatches.length,
    1,
    'migration_lock.toml のprovider定義が一意ではありません。',
  );
  assert.equal(
    providerMatches[0]?.[1],
    'postgresql',
    'migration_lock.toml のproviderはpostgresqlである必要があります。',
  );
}

async function readRequiredFile(file: string, label: string): Promise<Buffer> {
  try {
    return await readFile(file);
  } catch (error) {
    throw new Error(`${label}を読み込めません: ${file}`, { cause: error });
  }
}

async function assertMigrationLayout(paths: SchemaDriftPaths): Promise<number> {
  const schemaBytes = await readRequiredFile(paths.schemaFile, 'Prisma schema');
  assert.ok(schemaBytes.length > 0, 'Prisma schemaが空です。');

  const entries = await readdir(paths.migrationsDirectory, {
    withFileTypes: true,
  }).catch((error: unknown) => {
    throw new Error(
      `Prisma migrationディレクトリを読み込めません: ${paths.migrationsDirectory}`,
      { cause: error },
    );
  });

  const unexpectedFiles = entries.filter(
    (entry) => !entry.isDirectory() && entry.name !== 'migration_lock.toml',
  );
  assert.equal(
    unexpectedFiles.length,
    0,
    `migrationディレクトリに未認識のファイルがあります: ${unexpectedFiles.map((entry) => entry.name).join(', ')}`,
  );

  const migrationDirectories = entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  assert.ok(
    migrationDirectories.length > 0,
    'migrationディレクトリにmigrationが1件以上必要です。',
  );

  for (const directory of migrationDirectories) {
    const migrationFile = path.join(
      paths.migrationsDirectory,
      directory.name,
      'migration.sql',
    );
    const migrationBytes = await readRequiredFile(
      migrationFile,
      'migration.sql',
    );
    assert.ok(migrationBytes.length > 0, `${migrationFile} が空です。`);
  }
  return migrationDirectories.length;
}

function prismaEntryPoint(paths: SchemaDriftPaths): string {
  return path.join(
    paths.dbDirectory,
    'node_modules',
    'prisma',
    'build',
    'index.js',
  );
}

function diagnostics(result: PrismaDiffResult): string {
  const output = [result.stderr.trim(), result.stdout.trim()]
    .filter(Boolean)
    .join('\n');
  return output ? `\n${output.slice(0, 4000)}` : '';
}

// Prismaの終了状態と差分出力を両方検査し、CLI失敗やschema driftを合格へ変換しない。
export function assertPrismaDiffClean(result: PrismaDiffResult): void {
  if (result.error) {
    throw new Error(
      `Prisma migrate diffの実行に失敗しました: ${result.error.message}`,
      { cause: result.error },
    );
  }
  if (result.signal) {
    throw new Error(
      `Prisma migrate diffがシグナル(${result.signal})で終了しました。${diagnostics(result)}`,
    );
  }
  if (result.status === 2) {
    throw new Error(
      `Prisma schemaとmigrationに構造差分があります。${diagnostics(result)}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `Prisma migrate diffが失敗しました(exit=${String(result.status)})。${diagnostics(result)}`,
    );
  }
  if (result.stderr.trim()) {
    throw new Error(
      `Prisma migrate diffが標準エラーを出力しました。${diagnostics(result)}`,
    );
  }
  assert.equal(
    result.stdout.trim(),
    '',
    `Prisma schemaとmigrationに構造差分があります。${diagnostics(result)}`,
  );
}

export async function verifySchemaDrift(
  paths: SchemaDriftPaths = resolveSchemaDriftPaths(),
  runner: PrismaDiffRunner = runPrismaDiff,
  shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL,
): Promise<number> {
  const lockBytes = await readRequiredFile(
    paths.migrationLockFile,
    'migration_lock.toml',
  );
  const lockContent = lockBytes.toString('utf8');
  assertMigrationLock(lockContent);
  const migrationCount = await assertMigrationLayout(paths);
  const result = runner(
    process.execPath,
    [prismaEntryPoint(paths), ...buildPrismaDiffArgs(paths, shadowDatabaseUrl)],
    {
      cwd: paths.dbDirectory,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    },
  );
  assertPrismaDiffClean(result);
  return migrationCount;
}

async function main(): Promise<void> {
  const migrationCount = await verifySchemaDrift();
  console.log(
    `Prisma schemaとmigrationの構造差分はありません（migration ${migrationCount}件）。`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
