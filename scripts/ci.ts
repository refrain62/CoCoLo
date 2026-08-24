import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Mode = 'fast' | 'local' | 'staging';
type StepStatus = 'success' | 'failed';
type StepResult = Readonly<{
  name: string;
  status: StepStatus;
  durationMs: number;
}>;

const mode = process.argv[2] as Mode | undefined;
if (!mode || !['fast', 'local', 'staging'].includes(mode))
  throw new Error(
    'CIモードは fast、local、staging のいずれかで指定してください。',
  );

const root = process.cwd();
const reportDirectory = path.join(root, '.ci-reports');
const reportPath = path.join(reportDirectory, `ci-${mode}.json`);
const startedAt = new Date().toISOString();
const results: StepResult[] = [];
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const git = process.platform === 'win32' ? 'git.exe' : 'git';

function commandEnvironment(
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CI: 'true',
    ...extra,
  };
}

function run(
  command: string,
  args: string[],
  extraEnv?: Record<string, string>,
): void {
  const result = spawnSync(command, args, {
    cwd: root,
    env: commandEnvironment(extraEnv),
    stdio: 'inherit',
    // Windowsではpnpm.cmdをcmd.exe経由で起動する必要がある。引数は固定した配列だけを渡す。
    shell: process.platform === 'win32' && command === pnpm,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(' ')} が終了コード ${result.status ?? '不明'} で失敗しました。`,
    );
}

function runPnpm(args: string[], extraEnv?: Record<string, string>): void {
  run(pnpm, args, extraEnv);
}

function runGit(args: string[]): string {
  const result = spawnSync(git, args, {
    cwd: root,
    env: commandEnvironment(),
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')} が失敗しました。`);
  return result.stdout.trim();
}

async function writeReport(): Promise<void> {
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        mode,
        commit: runGit(['rev-parse', 'HEAD']),
        startedAt,
        finishedAt: new Date().toISOString(),
        steps: results,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

async function step(name: string, action: () => void): Promise<boolean> {
  const started = Date.now();
  try {
    console.log(`\n[ci:${mode}] ${name}`);
    action();
    results.push({ name, status: 'success', durationMs: Date.now() - started });
    return true;
  } catch (error) {
    results.push({ name, status: 'failed', durationMs: Date.now() - started });
    console.error(error instanceof Error ? error.message : error);
    await writeReport();
    return false;
  }
}

const publicBuildEnv = {
  VITE_SUPABASE_URL:
    process.env.VITE_SUPABASE_URL ?? 'https://quality-ref.supabase.co',
  VITE_SUPABASE_ANON_KEY:
    process.env.VITE_SUPABASE_ANON_KEY ?? 'quality-anon-key.jwt',
};

function fastSteps(): Array<readonly [string, () => void]> {
  return [
    [
      '依存関係を固定インストール（install script無効）',
      () =>
        runPnpm([
          'install',
          '--frozen-lockfile',
          '--ignore-scripts',
          '--config.confirmModulesPurge=false',
        ]),
    ],
    [
      'owner bootstrap済みのtrust rootを検証',
      () => runPnpm(['verify:trust-root']),
    ],
    ['Betterleaks秘密情報検査', () => runPnpm(['security:betterleaks'])],
    ['pnpm設定を検証', () => runPnpm(['verify:pnpm-config'])],
    ['Workflowを検証', () => runPnpm(['lint:workflows'])],
    ['migration SQLを静的検証', () => runPnpm(['verify:migration-sql'])],
    ['Biome静的検査', () => runPnpm(['lint:biome'])],
    ['workspace境界を検証', () => runPnpm(['verify:workspace-boundaries'])],
    [
      'Prisma schemaを静的検証',
      () => runPnpm(['--filter', '@cocolo/db', 'exec', 'prisma', 'generate']),
    ],
    [
      'OpenAPIを生成して差分を検証',
      () => {
        runPnpm(['generate:openapi']);
        runGit([
          'diff',
          '--exit-code',
          '--',
          'packages/contracts/openapi.yaml',
        ]);
        runPnpm(['lint:openapi']);
      },
    ],
    ['unit/contract test', () => runPnpm(['test:contract'])],
    ['unit test', () => runPnpm(['test:unit'])],
    ['typecheck', () => runPnpm(['typecheck'])],
    ['build', () => runPnpm(['build'], publicBuildEnv)],
  ];
}

async function runSteps(
  steps: Array<readonly [string, () => void]>,
): Promise<void> {
  for (const [name, action] of steps)
    if (!(await step(name, action)))
      throw new Error(`CIを中断しました。レポート: ${reportPath}`);
}

function requireStagingEnvironment(): void {
  if (process.env.APP_ENV !== 'staging')
    throw new Error('ci:staging は APP_ENV=staging のときだけ実行できます。');
  if (!process.env.STAGING_BASE_URL)
    throw new Error('ci:staging には STAGING_BASE_URL が必要です。');
  const url = new URL(process.env.STAGING_BASE_URL);
  if (url.protocol !== 'https:')
    throw new Error('ci:staging はHTTPSのstaging URLだけを受け付けます。');
  if (
    process.env.STAGING_PUBLIC_APP_URL &&
    new URL(process.env.STAGING_PUBLIC_APP_URL).origin !== url.origin
  )
    throw new Error('stagingの公開URLとE2E URLのoriginが一致しません。');
  for (const name of [
    'STAGING_DATABASE_URL',
    'STAGING_DIRECT_URL',
    'STAGING_DATABASE_ALLOWED_HOSTS',
    'STAGING_DATABASE_ALLOWED_DATABASES',
    'STAGING_DATABASE_ALLOWED_TARGETS',
    'STAGING_SUPABASE_URL',
    'STAGING_SUPABASE_JWKS_URL',
    'STAGING_SUPABASE_ANON_KEY',
    'STAGING_R2_ENDPOINT',
    'STAGING_R2_ACCESS_KEY_ID',
    'STAGING_R2_SECRET_ACCESS_KEY',
    'STAGING_PUBLIC_APP_URL',
    'STAGING_SUPABASE_ALLOWED_URL',
    'STAGING_SUPABASE_ALLOWED_JWKS_URL',
    'STAGING_PUBLIC_APP_URL_ALLOWLIST',
    'STAGING_RATE_LIMIT_ADAPTER_MODULE',
    'STAGING_DEPLOY_ADAPTER',
  ])
    if (!process.env[name])
      throw new Error(`ci:staging には ${name} が必要です。`);
  if (
    process.env.PRODUCTION_BASE_URL &&
    process.env.PRODUCTION_BASE_URL === process.env.STAGING_BASE_URL
  )
    throw new Error('staging URLとproduction URLを同一にできません。');
  if (
    process.env.PRODUCTION_DATABASE_URL &&
    process.env.PRODUCTION_DATABASE_URL === process.env.STAGING_DATABASE_URL
  )
    throw new Error('staging DB URLとproduction DB URLを同一にできません。');
  if (
    process.env.PRODUCTION_R2_ENDPOINT &&
    process.env.PRODUCTION_R2_ENDPOINT === process.env.STAGING_R2_ENDPOINT
  )
    throw new Error(
      'staging R2 endpointとproduction R2 endpointを同一にできません。',
    );
}

function stagingEnvironment(): Record<string, string> {
  requireStagingEnvironment();
  return {
    APP_ENV: 'staging',
    DATABASE_URL: process.env.STAGING_DATABASE_URL as string,
    DIRECT_URL: process.env.STAGING_DIRECT_URL as string,
    DATABASE_ALLOWED_HOSTS: process.env
      .STAGING_DATABASE_ALLOWED_HOSTS as string,
    DATABASE_ALLOWED_DATABASES: process.env
      .STAGING_DATABASE_ALLOWED_DATABASES as string,
    DATABASE_ALLOWED_TARGETS: process.env
      .STAGING_DATABASE_ALLOWED_TARGETS as string,
    SUPABASE_URL: process.env.STAGING_SUPABASE_URL as string,
    SUPABASE_JWKS_URL: process.env.STAGING_SUPABASE_JWKS_URL as string,
    SUPABASE_ANON_KEY: process.env.STAGING_SUPABASE_ANON_KEY as string,
    R2_ENDPOINT: process.env.STAGING_R2_ENDPOINT as string,
    R2_BUCKET: 'cocolo-staging-private',
    R2_ACCESS_KEY_ID: process.env.STAGING_R2_ACCESS_KEY_ID as string,
    R2_SECRET_ACCESS_KEY: process.env.STAGING_R2_SECRET_ACCESS_KEY as string,
    PUBLIC_APP_URL: process.env.STAGING_PUBLIC_APP_URL as string,
    STAGING_BASE_URL: process.env.STAGING_BASE_URL as string,
    SUPABASE_ALLOWED_URL: process.env.STAGING_SUPABASE_ALLOWED_URL as string,
    SUPABASE_ALLOWED_JWKS_URL: process.env
      .STAGING_SUPABASE_ALLOWED_JWKS_URL as string,
    PUBLIC_APP_URL_ALLOWLIST: process.env
      .STAGING_PUBLIC_APP_URL_ALLOWLIST as string,
    RATE_LIMIT_STORE: 'distributed',
    RATE_LIMIT_FAIL_CLOSED: 'true',
    RATE_LIMIT_ADAPTER_MODULE: process.env
      .STAGING_RATE_LIMIT_ADAPTER_MODULE as string,
    STAGING_DEPLOY_ADAPTER: process.env.STAGING_DEPLOY_ADAPTER as string,
    VITE_SUPABASE_URL: process.env.STAGING_SUPABASE_URL as string,
    VITE_SUPABASE_ANON_KEY: process.env.STAGING_SUPABASE_ANON_KEY as string,
    LOCAL_STAGING_DEPLOY: 'true',
  };
}

async function main(): Promise<void> {
  if (mode === 'fast') await runSteps(fastSteps());
  else if (mode === 'local') {
    await runSteps(fastSteps());
    await runSteps([
      [
        'local infrastructureの検証',
        () => runPnpm(['test:local-infrastructure']),
      ],
      ['database integrity検証', () => runPnpm(['test:database-integrity'])],
      ['schema drift検証', () => runPnpm(['test:schema-drift'])],
      ['integration test', () => runPnpm(['test:integration'])],
      ['local E2E', () => runPnpm(['test:e2e:local'])],
      ['全workspace test', () => runPnpm(['test'])],
      [
        'production bundle検証',
        () => runPnpm(['verify:production-bundle'], publicBuildEnv),
      ],
    ]);
  } else {
    const stagingEnv = stagingEnvironment();
    await runSteps([
      [
        'staging environmentをfail-closed検証',
        () =>
          runPnpm(['verify:environment', '--expected', 'staging'], stagingEnv),
      ],
      [
        'staging database securityを検証',
        () => runPnpm(['verify:database-security'], stagingEnv),
      ],
      [
        'staging database versionを検証',
        () => runPnpm(['verify:database-version'], stagingEnv),
      ],
      [
        'staging migrationを適用',
        () =>
          runPnpm(
            ['--filter', '@cocolo/db', 'exec', 'prisma', 'migrate', 'deploy'],
            stagingEnv,
          ),
      ],
      ['build', () => runPnpm(['build'], stagingEnv)],
      [
        'release artifactを作成',
        () =>
          runPnpm(
            [
              'package:release',
              '--artifact-sha',
              runGit(['rev-parse', 'HEAD']),
            ],
            stagingEnv,
          ),
      ],
      [
        'release artifactを検証',
        () =>
          runPnpm(
            ['verify:release', '--artifact-sha', runGit(['rev-parse', 'HEAD'])],
            stagingEnv,
          ),
      ],
      [
        'staging migration/deployを実行',
        () =>
          run(
            'node',
            [
              'scripts/deploy-artifact.ts',
              'staging',
              '--local',
              '--artifact-sha',
              runGit(['rev-parse', 'HEAD']),
            ],
            stagingEnv,
          ),
      ],
      ['staging smoke/E2E', () => runPnpm(['test:e2e:staging'], stagingEnv)],
    ]);
  }
  await writeReport();
  console.log(`CI完了。レポート: ${reportPath}`);
}

try {
  await main();
} catch (error) {
  await writeReport();
  throw error;
}
