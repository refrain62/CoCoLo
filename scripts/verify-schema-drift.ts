import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyMigrationBaseline } from './verify-migration-baseline.ts';
import {
  migrationPaths,
  parseMigrationManifest,
  readMigrationChecksums,
  verifyMigrationManifest,
} from './verify-migration-checksum.ts';
import {
  readMigrationHistory,
  verifyMigrationHistory,
} from './verify-migration-history.ts';

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
  env?: NodeJS.ProcessEnv;
}>;

export type PrismaDiffRunner = (
  command: string,
  args: readonly string[],
  options: PrismaDiffOptions,
) => PrismaDiffResult;

export type ShadowDatabaseConfig = Readonly<{
  environment?: string;
  databaseUrl?: string;
  directUrl?: string;
  expectedRole?: string;
  allowedHosts?: string;
  allowedDatabases?: string;
}>;

export type MigrationIntegrityVerifier = (
  paths: SchemaDriftPaths,
) => Promise<void>;

export type RedactedDatabaseUrl = Readonly<{
  argvUrl: string;
  password: string;
}>;

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
  shadowDatabaseUrlForArgv: string,
): readonly string[] {
  assert.ok(
    shadowDatabaseUrlForArgv,
    'Prisma CLIへ渡すShadow DB URLが必要です。',
  );
  const parsed = new URL(shadowDatabaseUrlForArgv);
  assert.equal(
    parsed.password,
    '',
    'Shadow DBのパスワードをPrisma CLIのargvへ渡してはいけません。',
  );
  return [
    'migrate',
    'diff',
    '--from-migrations',
    paths.migrationsDirectory,
    '--to-schema-datamodel',
    paths.schemaFile,
    '--shadow-database-url',
    shadowDatabaseUrlForArgv,
    '--script',
    '--exit-code',
  ];
}

export function redactDatabaseUrl(
  value: string | undefined,
): RedactedDatabaseUrl {
  assert.ok(value, 'Shadow DB URLが必要です。');
  const parsed = new URL(value);
  assert.ok(
    parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:',
    'Shadow DB URLはPostgreSQL URLで指定してください。',
  );
  const password = decodeURIComponent(parsed.password);
  parsed.password = '';
  parsed.searchParams.delete('password');
  return { argvUrl: parsed.toString(), password };
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

type DatabaseTarget = Readonly<{
  host: string;
  port: number;
  database: string;
  user: string;
}>;

function parseDatabaseTarget(
  value: string | undefined,
  label: string,
): DatabaseTarget {
  assert.ok(value, `${label}が必要です。`);
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`${label}はPostgreSQL URLで指定してください。`, {
      cause: error,
    });
  }
  assert.ok(
    url.protocol === 'postgresql:' || url.protocol === 'postgres:',
    `${label}はPostgreSQL URLで指定してください。`,
  );
  const database = decodeURIComponent(url.pathname.slice(1));
  assert.ok(database, `${label}にデータベース名がありません。`);
  assert.ok(url.hostname, `${label}にhostがありません。`);
  assert.ok(url.username, `${label}にroleがありません。`);
  return {
    host: url.hostname.toLowerCase(),
    port: Number(url.port || 5432),
    database,
    user: decodeURIComponent(url.username),
  };
}

function csvValues(value: string | undefined, label: string): string[] {
  const values = (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  assert.ok(values.length > 0, `${label}が必要です。`);
  return values;
}

function sameDatabase(left: DatabaseTarget, right: DatabaseTarget): boolean {
  return (
    left.host === right.host &&
    left.port === right.port &&
    left.database === right.database
  );
}

// Shadow DBはアプリ接続先と分離し、専用role・許可済みhost・DB名を満たす場合だけ使う。
// staging / productionでは同一hostも拒否し、同一PostgreSQLクラスタの誤指定を避ける。
export function validateShadowDatabaseConfig(
  shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL,
  environment = process.env.APP_ENV,
  databaseUrl = process.env.DATABASE_URL,
  directUrl = process.env.DIRECT_URL,
  expectedRole = process.env.SHADOW_DATABASE_ROLE,
  allowedHosts = process.env.SHADOW_DATABASE_ALLOWED_HOSTS,
  allowedDatabases = process.env.SHADOW_DATABASE_ALLOWED_DATABASES,
): void {
  assert.ok(
    environment,
    'APP_ENVが必要です。local、staging、productionのいずれかを指定してください。',
  );
  const primary = parseDatabaseTarget(databaseUrl, 'DATABASE_URL');
  const direct = parseDatabaseTarget(directUrl, 'DIRECT_URL');
  const shadow = parseDatabaseTarget(shadowDatabaseUrl, 'SHADOW_DATABASE_URL');
  assert.ok(expectedRole, 'SHADOW_DATABASE_ROLEが必要です。');
  assert.equal(
    shadow.user,
    expectedRole,
    'SHADOW_DATABASE_URLは専用roleを使用してください。',
  );
  assert.notEqual(
    shadow.user,
    primary.user,
    'Shadow DB roleをアプリ接続roleと共有できません。',
  );
  assert.notEqual(
    shadow.user,
    direct.user,
    'Shadow DB roleをmigration ownerと共有できません。',
  );
  assert.equal(
    sameDatabase(shadow, primary),
    false,
    'SHADOW_DATABASE_URLをDATABASE_URLと同じhost・port・DBへ設定できません。',
  );
  assert.equal(
    sameDatabase(shadow, direct),
    false,
    'SHADOW_DATABASE_URLをDIRECT_URLと同じhost・port・DBへ設定できません。',
  );

  const hosts = csvValues(allowedHosts, 'SHADOW_DATABASE_ALLOWED_HOSTS');
  const databases = csvValues(
    allowedDatabases,
    'SHADOW_DATABASE_ALLOWED_DATABASES',
  );
  assert.ok(
    hosts.includes(shadow.host),
    'SHADOW_DATABASE_URLのhostが許可リストにありません。',
  );
  assert.ok(
    databases.includes(shadow.database.toLowerCase()),
    'SHADOW_DATABASE_URLのDB名が許可リストにありません。',
  );

  if (environment === 'staging' || environment === 'production') {
    assert.notEqual(
      shadow.host,
      primary.host,
      'staging / productionのShadow DBはアプリDBと別hostにしてください。',
    );
    assert.notEqual(
      shadow.host,
      direct.host,
      'staging / productionのShadow DBはmigration DBと別hostにしてください。',
    );
  } else {
    assert.equal(
      environment,
      'local',
      'APP_ENVはlocal、staging、productionのいずれかにしてください。',
    );
  }
}

export async function verifyMigrationIntegrity(
  paths: SchemaDriftPaths,
  baseSha = process.env.BASE_SHA,
  ci = process.env.CI === 'true',
): Promise<void> {
  const root = path.dirname(path.dirname(paths.dbDirectory));
  const { manifestPath } = migrationPaths(root);
  const actual = await readMigrationChecksums(root);
  const manifestContent = await readFile(manifestPath, 'utf8');
  verifyMigrationManifest(actual, manifestContent);
  verifyMigrationBaseline(baseSha, root, ci);
  const directUrl = process.env.DIRECT_URL;
  assert.ok(directUrl, 'migration履歴検証にはDIRECT_URLが必要です。');
  verifyMigrationHistory(
    parseMigrationManifest(manifestContent),
    await readMigrationHistory(directUrl),
  );
}

// schema drift WorkflowはPR secretに依存せず、base SHAとShadow DB検査を必ず実行する。
export function assertSchemaDriftWorkflowConnected(content: string): void {
  assert.match(
    content,
    /^on:\s*\r?\n\s+pull_request:\s*$/m,
    'schema-drift Workflowはpull_requestで実行してください。',
  );
  const runMatch = /^\s*run:\s*pnpm verify:schema-drift\s*$/m.exec(content);
  assert.ok(
    runMatch,
    'schema-drift Workflowからverify:schema-driftを直接実行してください。',
  );
  const beforeRun = content.slice(0, runMatch.index);
  const stepStarts = [...beforeRun.matchAll(/^\s*-\s+name:\s*[^\r\n]*$/gm)];
  const stepStart = stepStarts.at(-1)?.index;
  assert.ok(stepStart !== undefined, 'verify:schema-driftのstep名が必要です。');
  const afterRun = content.slice(runMatch.index + runMatch[0].length);
  const nextStepOffset = afterRun.search(/^\s*-\s+name:\s*/m);
  const step = content.slice(
    stepStart,
    nextStepOffset < 0
      ? content.length
      : runMatch.index + runMatch[0].length + nextStepOffset,
  );
  assert.match(step, /^\s+env:\s*$/m, '検査stepにenvが必要です。');
  assert.match(
    step,
    /BASE_SHA:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}/,
    '検査stepはPRのbase SHAを使ってください。',
  );
  assert.match(step, /CI:\s*true/, '検査stepではCI=trueが必要です。');
  assert.match(
    step,
    /APP_ENV:\s*local/,
    'PRのschema drift検査はlocalの固定DBで実行してください。',
  );
  assert.doesNotMatch(
    step,
    /(?:^|\n)\s*if:\s*(?:false|\$\{\{\s*false\s*\}\})\s*$/m,
    'schema drift検査stepを無効化してはいけません。',
  );
  assert.doesNotMatch(
    step,
    /continue-on-error:\s*true/,
    'schema drift検査の失敗を無視してはいけません。',
  );
  assert.match(
    content,
    /BASE_SHA:/,
    'schema-drift WorkflowにBASE_SHAが必要です。',
  );
  assert.match(
    content,
    /SHADOW_DATABASE_URL:/,
    'schema-drift WorkflowにSHADOW_DATABASE_URLが必要です。',
  );
  assert.match(
    content,
    /SHADOW_DATABASE_ROLE:/,
    'schema-drift Workflowに専用role設定が必要です。',
  );
  assert.match(
    content,
    /SHADOW_DATABASE_ALLOWED_HOSTS:/,
    'schema-drift WorkflowにShadow DB host許可リストが必要です。',
  );
  assert.match(
    content,
    /SHADOW_DATABASE_ALLOWED_DATABASES:/,
    'schema-drift WorkflowにShadow DB名許可リストが必要です。',
  );
  assert.match(
    content,
    /fetch-depth:\s*0/,
    'base SHA取得用のfetch-depthが必要です。',
  );
  assert.match(
    content,
    /persist-credentials:\s*false/,
    'checkout credentialを保持してはいけません。',
  );
  assert.match(content, /CI:\s*true/, 'CI実行ではCI=trueが必要です。');
  assert.doesNotMatch(
    content,
    /\bsecrets(?:\.|\s*:)/,
    'PR secretをschema drift検査へ渡してはいけません。',
  );
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
  config: ShadowDatabaseConfig = {},
  integrityVerifier: MigrationIntegrityVerifier = verifyMigrationIntegrity,
): Promise<number> {
  validateShadowDatabaseConfig(
    shadowDatabaseUrl,
    config.environment,
    config.databaseUrl,
    config.directUrl,
    config.expectedRole,
    config.allowedHosts,
    config.allowedDatabases,
  );
  const lockBytes = await readRequiredFile(
    paths.migrationLockFile,
    'migration_lock.toml',
  );
  const lockContent = lockBytes.toString('utf8');
  assertMigrationLock(lockContent);
  const migrationCount = await assertMigrationLayout(paths);
  await integrityVerifier(paths);
  const redactedShadowUrl = redactDatabaseUrl(shadowDatabaseUrl);
  assert.equal(
    redactedShadowUrl.password,
    '',
    'SHADOW_DATABASE_URLにパスワードを含めず、専用の外部認証を設定してください。',
  );
  const result = runner(
    process.execPath,
    [
      prismaEntryPoint(paths),
      ...buildPrismaDiffArgs(paths, redactedShadowUrl.argvUrl),
    ],
    {
      cwd: paths.dbDirectory,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        SHADOW_DATABASE_URL: shadowDatabaseUrl,
      },
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
