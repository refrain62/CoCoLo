import assert from 'node:assert/strict';
import {
  type ChildProcess,
  type SpawnSyncReturns,
  spawn,
  spawnSync,
} from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPostgresClient } from './postgres-client.ts';

type StackName = 'dev' | 'test';
type Stack = {
  name: StackName;
  projectId: 'cocolo-local' | 'cocolo-test';
  directory: string;
  apiPort: number;
  dbPort: number;
  appPort: number;
  webPort: number;
  removeVolumesOnStop: boolean;
};

type SupabaseStatus = {
  apiUrl: string;
  dbUrl: string;
  anonKey: string;
  serviceRoleKey: string;
};

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stacks: Record<StackName, Stack> = {
  dev: {
    name: 'dev',
    projectId: 'cocolo-local',
    directory: root,
    apiPort: 54321,
    dbPort: 54322,
    appPort: 8787,
    webPort: 5173,
    removeVolumesOnStop: false,
  },
  test: {
    name: 'test',
    projectId: 'cocolo-test',
    directory: path.join(root, 'test-infrastructure'),
    apiPort: 55321,
    dbPort: 55322,
    appPort: 8788,
    webPort: 4173,
    removeVolumesOnStop: true,
  },
};

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function loadDotEnv(): Record<string, string> {
  const file = path.join(root, '.env');
  if (!existsSync(file)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (!key) continue;
    const raw = match[2] ?? '';
    values[key] =
      raw.startsWith('"') && raw.endsWith('"')
        ? raw.slice(1, -1).replaceAll('\\n', '\n')
        : raw.startsWith("'") && raw.endsWith("'")
          ? raw.slice(1, -1)
          : raw;
  }
  return values;
}

function baseEnvironment(): NodeJS.ProcessEnv {
  return { ...loadDotEnv(), ...process.env };
}

function run(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    capture?: boolean;
    allowFailure?: boolean;
    shell?: boolean;
  },
): SpawnSyncReturns<string> {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    shell:
      options.shell ??
      (process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')),
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (!options.allowFailure)
    assert.equal(
      result.status,
      0,
      `${command} ${args.join(' ')} が失敗しました。`,
    );
  return result;
}

function runPnpm(
  args: string[],
  env: NodeJS.ProcessEnv,
  options: {
    capture?: boolean;
    allowFailure?: boolean;
    cwd?: string;
  } = {},
) {
  return run(pnpmCommand, args, {
    cwd: options.cwd ?? root,
    env,
    ...options,
  });
}

function runNodeScript(
  script: string,
  env: NodeJS.ProcessEnv,
  options: { allowFailure?: boolean } = {},
) {
  return run(process.execPath, [path.join(root, 'scripts', script)], {
    cwd: root,
    env,
    ...options,
  });
}

function runSupabase(
  stack: Stack,
  args: string[],
  options: { capture?: boolean; allowFailure?: boolean } = {},
) {
  return runPnpm(
    ['exec', 'supabase', '--workdir', stack.directory, ...args],
    baseEnvironment(),
    {
      ...options,
      // CLIのworking directoryがproject_idとvolumeを決めるため、stackごとに固定する。
      cwd: stack.directory,
    },
  );
}

function parseStatus(output: string, stack: Stack): SupabaseStatus {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  assert.ok(
    start >= 0 && end > start,
    'Supabase statusのJSONを読み取れません。',
  );
  const parsed = JSON.parse(output.slice(start, end + 1)) as unknown;
  const values = new Map<string, string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (typeof nested === 'string') values.set(key.toUpperCase(), nested);
      else visit(nested);
    }
  };
  visit(parsed);
  const apiUrl = values.get('API_URL') ?? `http://127.0.0.1:${stack.apiPort}`;
  const dbUrl =
    values.get('DB_URL') ??
    `postgresql://postgres:postgres@127.0.0.1:${stack.dbPort}/postgres`;
  const anonKey = values.get('ANON_KEY');
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY');
  assert.ok(anonKey, 'Supabase statusにANON_KEYがありません。');
  assert.ok(serviceRoleKey, 'Supabase statusにSERVICE_ROLE_KEYがありません。');
  return { apiUrl, dbUrl, anonKey, serviceRoleKey };
}

function getStatus(stack: Stack): SupabaseStatus {
  const result = runSupabase(stack, ['status', '-o', 'json'], {
    capture: true,
    allowFailure: true,
  });
  assert.equal(
    result.status,
    0,
    `${stack.projectId} Supabaseが起動していません。`,
  );
  return parseStatus(result.stdout, stack);
}

function postgresUrl(stack: Stack, user: string, password: string): string {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${stack.dbPort}/postgres`;
}

function createApplicationEnvironment(
  stack: Stack,
  status: SupabaseStatus,
): NodeJS.ProcessEnv {
  const env = baseEnvironment();
  const appDbUrl = postgresUrl(
    stack,
    'cocolo_app',
    env.COCOLO_APP_PASSWORD ?? 'cocolo_app',
  );
  const migrationDbUrl = postgresUrl(
    stack,
    'cocolo_migration',
    env.COCOLO_MIGRATION_PASSWORD ?? 'cocolo_migration',
  );
  return {
    ...env,
    APP_ENV: 'local',
    TEST_STACK_PROJECT: stack.projectId,
    COCOLO_MIGRATION_ROLE: 'cocolo_migration',
    TEST_DATABASE_RESET_ALLOWED: stack.name === 'test' ? 'true' : 'false',
    DATABASE_URL: appDbUrl,
    DIRECT_URL: migrationDbUrl,
    SUPABASE_URL: status.apiUrl.replace(/\/$/, ''),
    SUPABASE_JWKS_URL: `${status.apiUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`,
    SUPABASE_ANON_KEY: status.anonKey,
    PORT: String(stack.appPort),
    PUBLIC_APP_URL: `http://localhost:${stack.webPort}`,
    PUBLIC_APP_URL_ALLOWLIST: `http://localhost:${stack.webPort},http://127.0.0.1:${stack.webPort}`,
    R2_BUCKET: 'cocolo-local',
    R2_ENDPOINT: env.R2_ENDPOINT ?? 'http://127.0.0.1:9000',
    R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID ?? 'local-r2-access-key',
    R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY ?? 'local-r2-secret-key',
    RATE_LIMIT_STORE: 'memory',
    RATE_LIMIT_FAIL_CLOSED: 'true',
    RATE_LIMIT_ADAPTER_MODULE: '',
    VITE_SUPABASE_URL: status.apiUrl.replace(/\/$/, ''),
    VITE_SUPABASE_ANON_KEY: status.anonKey,
    VITE_APP_ENV: 'local',
    VITE_PORT: String(stack.webPort),
    VITE_API_PROXY_URL: `http://127.0.0.1:${stack.appPort}`,
    E2E_API_PORT: String(stack.appPort),
    E2E_WEB_PORT: String(stack.webPort),
  };
}

async function hasMigrationHistory(dbUrl: string): Promise<boolean> {
  return withPostgresClient(dbUrl, async (client) => {
    const rows = await client.$queryRawUnsafe<Array<{ exists: boolean }>>(
      "SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS exists",
    );
    return rows[0]?.exists === true;
  });
}

function stopStack(stack: Stack, removeVolumes: boolean): void {
  runSupabase(stack, ['stop', ...(removeVolumes ? ['--no-backup'] : [])], {
    allowFailure: true,
  });
}

async function prepareStack(
  stack: Stack,
  options: { forceFresh: boolean },
): Promise<{ env: NodeJS.ProcessEnv; status: SupabaseStatus }> {
  if (options.forceFresh) stopStack(stack, true);
  runPnpm(
    ['--filter', '@cocolo/db', 'exec', 'prisma', 'generate'],
    baseEnvironment(),
  );
  runSupabase(stack, ['start']);
  const status = getStatus(stack);
  const appEnv = createApplicationEnvironment(stack, status);
  const fresh = !(await hasMigrationHistory(status.dbUrl));

  // status.DB_URLはSupabaseが生成したpostgres owner URLであり、role作成専用に一度だけ使う。
  runNodeScript('db-prepare-test.ts', {
    ...appEnv,
    DATABASE_URL: status.dbUrl,
    DIRECT_URL: status.dbUrl,
    COCOLO_ADMIN_BYPASSRLS: stack.name === 'test' ? 'true' : 'false',
  });
  runPnpm(
    ['--filter', '@cocolo/db', 'exec', 'prisma', 'migrate', 'deploy'],
    appEnv,
  );
  // Prisma migration後にfixture専用roleの対象テーブル権限を付与する。
  // 初回のdb-prepareはrole作成を先に行うため、migration前でも安全に再実行できる。
  if (appEnv.COCOLO_MIGRATION_ROLE) {
    runNodeScript('db-prepare-test.ts', {
      ...appEnv,
      DATABASE_URL: appEnv.DIRECT_URL,
      DIRECT_URL: appEnv.DIRECT_URL,
      COCOLO_FIXTURE_GRANTS_ONLY: 'true',
    });
    runNodeScript('db-prepare-test.ts', {
      ...appEnv,
      DATABASE_URL: appEnv.DIRECT_URL,
      DIRECT_URL: appEnv.DIRECT_URL,
      COCOLO_ADMIN_GRANTS_ONLY: 'true',
    });
  }
  if (fresh) {
    runNodeScript('local-auth-fixture.ts', {
      ...appEnv,
      SUPABASE_ADMIN_DATABASE_URL: status.dbUrl,
      SUPABASE_SERVICE_ROLE_KEY: status.serviceRoleKey,
    });
  }
  return { env: appEnv, status };
}

function killChild(child: ChildProcess): void {
  if (!child.killed) child.kill('SIGTERM');
}

async function runHostDevelopment(env: NodeJS.ProcessEnv): Promise<void> {
  const api = spawn(pnpmCommand, ['--filter', '@cocolo/api', 'dev'], {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const web = spawn(
    pnpmCommand,
    ['--filter', '@cocolo/web', 'dev', '--host', '127.0.0.1'],
    { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  const children = [api, web];
  let stopped = false;
  const shutdown = () => {
    if (stopped) return;
    stopped = true;
    for (const child of children) killChild(child);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await new Promise<void>((resolve) => {
      for (const child of children)
        child.once('exit', () => {
          shutdown();
          resolve();
        });
    });
  } finally {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    shutdown();
  }
}

async function runPlaywright(
  env: NodeJS.ProcessEnv,
  extraArgs: string[],
): Promise<number> {
  const result = runPnpm(
    [
      'exec',
      'playwright',
      'test',
      '--config=playwright.config.ts',
      '--project',
      'local',
      ...extraArgs,
    ],
    env,
    { allowFailure: true },
  );
  return result.error ? 1 : (result.status ?? 1);
}

async function runIntegration(): Promise<void> {
  const stack = stacks.test;
  const prepared = await prepareStack(stack, { forceFresh: true });
  try {
    // 統合テストのseed/cleanupだけは、ephemeralなtest stackの管理者接続で行う。
    // 管理者URLはこの子プロセスにだけ渡し、アプリ本体のDATABASE_URLには使わない。
    const integrationEnv = {
      ...prepared.env,
      DIRECT_URL: prepared.status.dbUrl,
    };
    const result = runPnpm(['test:integration:raw'], integrationEnv, {
      allowFailure: true,
    });
    assert.equal(
      result.status,
      0,
      'Supabase test DBの統合テストに失敗しました。',
    );
  } finally {
    stopStack(stack, true);
  }
}

async function runE2E(extraArgs: string[]): Promise<void> {
  const stack = stacks.test;
  const prepared = await prepareStack(stack, { forceFresh: true });
  try {
    const status = await runPlaywright(prepared.env, extraArgs);
    assert.equal(status, 0, 'Supabase test DBのE2Eに失敗しました。');
  } finally {
    stopStack(stack, true);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'dev';
  if (command === 'status') {
    const status = getStatus(stacks.dev);
    console.log(
      JSON.stringify({
        apiUrl: status.apiUrl,
        dbPort: stacks.dev.dbPort,
        projectId: stacks.dev.projectId,
      }),
    );
    return;
  }
  if (command === 'stop') {
    stopStack(stacks.dev, false);
    return;
  }
  if (command === 'reset') {
    assert.equal(
      process.env.LOCAL_DATABASE_RESET,
      'true',
      '開発DBの再構築にはLOCAL_DATABASE_RESET=trueが必要です。',
    );
    await prepareStack(stacks.dev, { forceFresh: true });
    return;
  }
  if (command === 'integration') {
    await runIntegration();
    return;
  }
  if (command === 'e2e') {
    const separator = process.argv.indexOf('--');
    await runE2E(separator === -1 ? [] : process.argv.slice(separator + 1));
    return;
  }
  assert.equal(command, 'dev', 'supabase-localのcommandが不正です。');
  const prepared = await prepareStack(stacks.dev, { forceFresh: false });
  try {
    await runHostDevelopment(prepared.env);
  } finally {
    stopStack(stacks.dev, false);
  }
}

await main();
