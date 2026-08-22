import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export type SchemaDriftResult = Readonly<{
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: Error;
}>;

export function assertSchemaDriftClean(result: SchemaDriftResult): void {
  if (result.error) throw result.error;
  assert.equal(
    result.signal,
    null,
    `schema drift検査がシグナル終了しました: ${result.signal}`,
  );
  assert.equal(
    result.status,
    0,
    `Prisma schemaとmigrationに差分があります(exit=${String(result.status)}): ${result.stdout || result.stderr}`,
  );
  assert.equal(
    result.stderr.trim(),
    '',
    `schema drift検査がstderrを出力しました: ${result.stderr}`,
  );
  assert.match(
    result.stdout,
    /empty migration|^\s*$/i,
    `schema drift検査の出力が不正です: ${result.stdout}`,
  );
}

function requiredUrl(name: string): URL {
  const value = process.env[name];
  assert.ok(value, `${name}が必要です。`);
  const url = new URL(value);
  assert.ok(
    url.protocol === 'postgresql:' || url.protocol === 'postgres:',
    `${name}はPostgreSQL URLで指定してください。`,
  );
  return url;
}

export function assertLocalShadowConfiguration(): void {
  assert.equal(
    process.env.APP_ENV,
    'local',
    'schema drift検査はlocal環境専用です。',
  );
  const direct = requiredUrl('DIRECT_URL');
  const shadow = requiredUrl('SHADOW_DATABASE_URL');
  assert.equal(
    shadow.hostname,
    'localhost',
    'Shadow DB hostはlocalhostに固定します。',
  );
  assert.equal(
    shadow.port || '5432',
    '5432',
    'Shadow DB portは5432に固定します。',
  );
  assert.notEqual(
    shadow.pathname,
    direct.pathname,
    'Shadow DBをmigration DBと共有できません。',
  );
}

function run(): SchemaDriftResult {
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  return spawnSync(
    pnpm,
    [
      '--filter',
      '@cocolo/db',
      'exec',
      'prisma',
      'migrate',
      'diff',
      '--from-migrations',
      'prisma/migrations',
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--shadow-database-url',
      process.env.SHADOW_DATABASE_URL ?? '',
      '--script',
      '--exit-code',
    ],
    { encoding: 'utf8', shell: false, windowsHide: true },
  ) as SchemaDriftResult;
}

async function main(): Promise<void> {
  assertLocalShadowConfiguration();
  assertSchemaDriftClean(run());
  console.log(
    'Prisma schemaとmigrationのschema driftがないことを検証しました。',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
