import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertMigrationLock,
  assertPrismaDiffClean,
  buildPrismaDiffArgs,
  type PrismaDiffResult,
  redactDatabaseUrl,
  type SchemaDriftPaths,
  validateShadowDatabaseConfig,
  verifySchemaDrift,
} from './verify-schema-drift.ts';

const shadowDatabaseUrl =
  'postgresql://cocolo_shadow:cocolo_shadow@localhost:5432/cocolo_shadow';
const shadowDatabaseArg =
  'postgresql://cocolo_shadow@localhost:5432/cocolo_shadow';

const shadowConfig = {
  environment: 'local',
  databaseUrl: 'postgresql://cocolo_app:cocolo_app@localhost:5432/cocolo_local',
  directUrl:
    'postgresql://cocolo_migration:cocolo_migration@localhost:5432/cocolo_local',
  expectedRole: 'cocolo_shadow',
  allowedHosts: 'localhost',
  allowedDatabases: 'cocolo_shadow',
};

const cleanResult: PrismaDiffResult = {
  status: 0,
  signal: null,
  stdout: '',
  stderr: '',
};

function fixturePaths(root: string): SchemaDriftPaths {
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

async function createFixture(includeLock = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cocolo-schema-drift-'));
  const paths = fixturePaths(root);
  await mkdir(path.join(paths.migrationsDirectory, '20260823000000_fixture'), {
    recursive: true,
  });
  await writeFile(
    paths.schemaFile,
    'datasource db { provider = "postgresql" }\n',
  );
  await writeFile(
    path.join(
      paths.migrationsDirectory,
      '20260823000000_fixture',
      'migration.sql',
    ),
    'CREATE TABLE fixture (id uuid PRIMARY KEY);\n',
  );
  const migrationBytes = await readFile(
    path.join(
      paths.migrationsDirectory,
      '20260823000000_fixture',
      'migration.sql',
    ),
  );
  await writeFile(
    path.join(paths.migrationsDirectory, '..', 'migrations.sha256'),
    `${createHash('sha256').update(migrationBytes).digest('hex')}  20260823000000_fixture/migration.sql\n`,
  );
  if (includeLock)
    await writeFile(
      paths.migrationLockFile,
      '# Prisma Migrate lock file\nprovider = "postgresql"\n',
    );
  return { root, paths };
}

test('PostgreSQLのmigration_lock.tomlだけを受理する', () => {
  assert.doesNotThrow(() =>
    assertMigrationLock(
      '# Prisma Migrate lock file\nprovider = "postgresql"\n',
    ),
  );
  assert.throws(
    () => assertMigrationLock('provider = "mysql"\n'),
    /providerはpostgresql/,
  );
  assert.throws(
    () => assertMigrationLock('provider = "postgresql"\nprovider = "mysql"\n'),
    /provider定義が一意ではありません/,
  );
});

test('shadow database URLの欠落を成功扱いにしない', () => {
  assert.throws(
    () =>
      validateShadowDatabaseConfig(
        undefined,
        'local',
        'postgresql://cocolo_app:cocolo_app@localhost:5432/cocolo_local',
        'postgresql://cocolo_migration:cocolo_migration@localhost:5432/cocolo_local',
        'cocolo_shadow',
        'localhost',
        'cocolo_shadow',
      ),
    /SHADOW_DATABASE_URLが必要です/,
  );
});

test('同じhost・port・DBのShadow URLを拒否する', () => {
  assert.throws(
    () =>
      validateShadowDatabaseConfig(
        'postgresql://cocolo_shadow:cocolo_shadow@localhost:5432/cocolo_local',
        'local',
        'postgresql://cocolo_app:cocolo_app@localhost:5432/cocolo_local',
        'postgresql://cocolo_migration:cocolo_migration@localhost:5432/cocolo_local',
        'cocolo_shadow',
        'localhost',
        'cocolo_shadow',
      ),
    /DATABASE_URLと同じhost・port・DB/,
  );
});

test('Shadow DBのパスワードをargvから除去する', () => {
  const redacted = redactDatabaseUrl(shadowDatabaseUrl);
  assert.equal(redacted.argvUrl, shadowDatabaseArg);
  assert.equal(redacted.password, 'cocolo_shadow');
  assert.throws(
    () =>
      buildPrismaDiffArgs(
        fixturePaths('C:\\schema-drift-fixture'),
        shadowDatabaseUrl,
      ),
    /パスワードをPrisma CLIのargvへ渡してはいけません/,
  );
});

test('本番相当環境でprimaryと同じhostのShadow URLを拒否する', () => {
  assert.throws(
    () =>
      validateShadowDatabaseConfig(
        'postgresql://cocolo_shadow:cocolo_shadow@prod-db.example:5432/cocolo_shadow',
        'production',
        'postgresql://cocolo_app:cocolo_app@prod-db.example:5432/cocolo_prod',
        'postgresql://cocolo_migration:cocolo_migration@migration.example:5432/cocolo_prod',
        'cocolo_shadow',
        'prod-db.example',
        'cocolo_shadow',
      ),
    /アプリDBと別host/,
  );
});

test('migration_lock.tomlの欠落を成功扱いにしない', async () => {
  const fixture = await createFixture(false);
  let called = false;
  try {
    await assert.rejects(
      () =>
        verifySchemaDrift(
          fixture.paths,
          () => {
            called = true;
            return cleanResult;
          },
          shadowDatabaseUrl,
          shadowConfig,
          async () => undefined,
        ),
      /migration_lock\.tomlを読み込めません/,
    );
    assert.equal(called, false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('Prisma migrate diffの差分終了コードを失敗にする', () => {
  assert.throws(
    () =>
      assertPrismaDiffClean({
        ...cleanResult,
        status: 2,
        stdout: 'ALTER TABLE fixture ADD COLUMN drifted text;',
      }),
    /構造差分があります/,
  );
});

test('Prisma CLIのspawn errorと未知の終了コードを失敗にする', () => {
  assert.throws(
    () =>
      assertPrismaDiffClean({
        ...cleanResult,
        status: null,
        error: new Error('prisma not found'),
      }),
    /実行に失敗しました: prisma not found/,
  );
  assert.throws(
    () => assertPrismaDiffClean({ ...cleanResult, status: 1 }),
    /失敗しました\(exit=1\)/,
  );
});

test('終了コード0でも差分SQLの出力を成功扱いにしない', () => {
  assert.throws(
    () =>
      assertPrismaDiffClean({
        ...cleanResult,
        stdout: 'ALTER TABLE fixture ADD COLUMN drifted text;',
      }),
    /構造差分があります/,
  );
});

test('終了コード0でもPrisma CLIの標準エラーを成功扱いにしない', () => {
  assert.throws(
    () =>
      assertPrismaDiffClean({
        ...cleanResult,
        stderr: 'unexpected prisma warning',
      }),
    /標準エラーを出力しました/,
  );
});

test('差分なしではPrisma CLIをexit-code付きで実行して成功する', async () => {
  const fixture = await createFixture();
  let received:
    | {
        command: string;
        args: readonly string[];
        cwd: string;
        env?: NodeJS.ProcessEnv;
      }
    | undefined;
  try {
    const migrationCount = await verifySchemaDrift(
      fixture.paths,
      (command, args, options) => {
        received = {
          command,
          args,
          cwd: options.cwd,
          env: options.env,
        };
        return cleanResult;
      },
      shadowDatabaseUrl,
      shadowConfig,
      async () => undefined,
    );
    assert.equal(migrationCount, 1);
    assert.ok(received);
    assert.equal(received.cwd, fixture.paths.dbDirectory);
    assert.deepEqual(
      [
        path.join(
          fixture.paths.dbDirectory,
          'node_modules',
          'prisma',
          'build',
          'index.js',
        ),
        ...buildPrismaDiffArgs(fixture.paths, shadowDatabaseArg),
      ],
      received.args,
    );
    assert.equal(received.command, process.execPath);
    assert.equal(received.env?.SHADOW_DATABASE_URL, shadowDatabaseUrl);
    assert.equal(received.env?.PGPASSWORD, 'cocolo_shadow');
    assert.equal(
      received.args.includes(shadowDatabaseUrl),
      false,
      'Shadow DB URLをPrisma CLIのargvへ渡してはいけません。',
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('migration履歴DBへ接続できない場合はfail-closedにする', async () => {
  const fixture = await createFixture();
  let called = false;
  try {
    await assert.rejects(
      () =>
        verifySchemaDrift(
          fixture.paths,
          () => {
            called = true;
            return cleanResult;
          },
          shadowDatabaseUrl,
          shadowConfig,
          async () => {
            throw new Error('ECONNREFUSED');
          },
        ),
      /ECONNREFUSED/,
    );
    assert.equal(called, false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
