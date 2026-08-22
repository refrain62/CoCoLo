import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';

// Workflowを許可された構造とActionだけに限定し、PR自身による検査対象の追加や権限変更を検出する。
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = path.join(root, '.github', 'workflows');
const workflowFiles = [
  'quality.yml',
  'staging-deploy.yml',
  'production-promote.yml',
] as const;
type WorkflowName = (typeof workflowFiles)[number];
type WorkflowRecord = Record<string, unknown>;

function githubExpression(body: string): string {
  return ['$', '{', '{ ', body, ' }}'].join('');
}

const actionAllowlist = {
  'actions/checkout': '11bd71901bbe5b1630ceea73d27597364c9af683',
  'actions/attest-build-provenance': 'e8998f949152b193b063cb0ec769d69d929409be',
  'actions/setup-node': '49933ea5288caeca8642d1e84afbd3f7d6820020',
  'actions/upload-artifact': 'ea165f8d65b6e75b540449e92b4886f43607fa02',
  'pnpm/action-setup': 'f40ffcd9367d9f12939873eb1018b921a783ffaa',
} as const;

type StepPolicy = {
  kind: 'run' | 'uses';
  action?: string;
  withValues?: Record<string, unknown>;
  envValues?: Record<string, unknown>;
};

const qualitySteps: readonly StepPolicy[] = [
  {
    kind: 'uses',
    action: `actions/checkout@${actionAllowlist['actions/checkout']}`,
    withValues: { 'persist-credentials': false },
  },
  {
    kind: 'uses',
    action: `pnpm/action-setup@${actionAllowlist['pnpm/action-setup']}`,
    withValues: { version: '10.26.0' },
  },
  {
    kind: 'uses',
    action: `actions/setup-node@${actionAllowlist['actions/setup-node']}`,
    withValues: { 'node-version': 24 },
  },
  { kind: 'run' },
  { kind: 'run' },
  {
    kind: 'run',
    envValues: {
      DATABASE_URL:
        'postgresql://cocolo_app:cocolo_app@localhost:5432/cocolo_test',
      DIRECT_URL: 'postgresql://postgres:postgres@localhost:5432/cocolo_test',
    },
  },
  {
    kind: 'run',
    envValues: {
      DATABASE_URL:
        'postgresql://cocolo_app:cocolo_app@localhost:5432/cocolo_test',
      DIRECT_URL: 'postgresql://postgres:postgres@localhost:5432/cocolo_test',
    },
  },
  {
    kind: 'run',
    envValues: {
      DATABASE_URL:
        'postgresql://cocolo_app:cocolo_app@localhost:5432/cocolo_test',
      DIRECT_URL: 'postgresql://postgres:postgres@localhost:5432/cocolo_test',
    },
  },
  { kind: 'run' },
];

const stagingSteps: readonly StepPolicy[] = [
  {
    kind: 'uses',
    action: `actions/checkout@${actionAllowlist['actions/checkout']}`,
    withValues: { 'persist-credentials': false },
  },
  {
    kind: 'uses',
    action: `pnpm/action-setup@${actionAllowlist['pnpm/action-setup']}`,
    withValues: { version: '10.26.0' },
  },
  {
    kind: 'uses',
    action: `actions/setup-node@${actionAllowlist['actions/setup-node']}`,
    withValues: { 'node-version': 24, cache: 'pnpm' },
  },
  { kind: 'run' },
  {
    kind: 'run',
    envValues: {
      APP_ENV: 'staging',
      DATABASE_URL: githubExpression('secrets.DATABASE_URL'),
      DIRECT_URL: githubExpression('secrets.DIRECT_URL'),
      SUPABASE_URL: githubExpression('vars.SUPABASE_URL'),
      SUPABASE_JWKS_URL: githubExpression('vars.SUPABASE_JWKS_URL'),
      SUPABASE_ALLOWED_URL: githubExpression('vars.SUPABASE_URL'),
      SUPABASE_ALLOWED_JWKS_URL: githubExpression('vars.SUPABASE_JWKS_URL'),
      SUPABASE_ANON_KEY: githubExpression('secrets.SUPABASE_ANON_KEY'),
      R2_BUCKET: 'cocolo-staging-private',
      PUBLIC_APP_URL: githubExpression('vars.PUBLIC_APP_URL'),
      PUBLIC_APP_URL_ALLOWLIST: githubExpression(
        'vars.PUBLIC_APP_URL_ALLOWLIST',
      ),
    },
  },
  {
    kind: 'run',
    envValues: {
      DATABASE_URL: githubExpression('secrets.DATABASE_URL'),
      DIRECT_URL: githubExpression('secrets.DIRECT_URL'),
    },
  },
  {
    kind: 'run',
    envValues: {
      DATABASE_URL: githubExpression('secrets.DATABASE_URL'),
      DIRECT_URL: githubExpression('secrets.DIRECT_URL'),
    },
  },
  {
    kind: 'run',
    envValues: { DATABASE_URL: githubExpression('secrets.DATABASE_URL') },
  },
  {
    kind: 'run',
    envValues: {
      DATABASE_URL: githubExpression('secrets.DATABASE_URL'),
      DIRECT_URL: githubExpression('secrets.DIRECT_URL'),
    },
  },
  {
    kind: 'run',
    envValues: {
      ARTIFACT_SHA: githubExpression('github.sha'),
      VITE_SUPABASE_URL: githubExpression('vars.SUPABASE_URL'),
      VITE_SUPABASE_ANON_KEY: githubExpression('secrets.SUPABASE_ANON_KEY'),
    },
  },
  { kind: 'run' },
  {
    kind: 'uses',
    action: `actions/attest-build-provenance@${actionAllowlist['actions/attest-build-provenance']}`,
    withValues: { 'subject-path': '.release/release.tar.gz' },
  },
  {
    kind: 'run',
    envValues: {
      STAGING_DEPLOY_ADAPTER: githubExpression(
        'secrets.STAGING_DEPLOY_ADAPTER',
      ),
    },
  },
  {
    kind: 'run',
    envValues: {
      APP_ENV: 'staging',
      STAGING_BASE_URL: githubExpression('vars.PUBLIC_APP_URL'),
      E2E_TEST_EMAIL: githubExpression('secrets.STAGING_E2E_TEST_EMAIL'),
      E2E_TEST_PASSWORD: githubExpression('secrets.STAGING_E2E_TEST_PASSWORD'),
    },
  },
  {
    kind: 'run',
    envValues: {
      ARTIFACT_SHA: githubExpression('github.sha'),
      STAGING_BASE_URL: githubExpression('vars.PUBLIC_APP_URL'),
      STAGING_DEPLOYMENT_RECORD: '.release/deployment-record.json',
    },
  },
  {
    kind: 'uses',
    action: `actions/upload-artifact@${actionAllowlist['actions/upload-artifact']}`,
    withValues: {
      name: ['release-', githubExpression('github.sha')].join(''),
      path: '.release',
      'if-no-files-found': 'error',
      'retention-days': 14,
    },
  },
  {
    kind: 'uses',
    action: `actions/upload-artifact@${actionAllowlist['actions/upload-artifact']}`,
    withValues: {
      name: ['staging-evidence-', githubExpression('github.sha')].join(''),
      path: '.evidence',
      'if-no-files-found': 'error',
      'retention-days': 14,
    },
  },
];

const productionSteps: readonly StepPolicy[] = [
  {
    kind: 'run',
    envValues: {
      GH_TOKEN: githubExpression('github.token'),
      ARTIFACT_SHA: githubExpression('inputs.artifact_sha'),
    },
  },
  {
    kind: 'uses',
    action: `actions/checkout@${actionAllowlist['actions/checkout']}`,
    withValues: {
      'persist-credentials': false,
      ref: githubExpression('inputs.artifact_sha'),
    },
  },
  {
    kind: 'uses',
    action: `pnpm/action-setup@${actionAllowlist['pnpm/action-setup']}`,
    withValues: { version: '10.26.0' },
  },
  {
    kind: 'uses',
    action: `actions/setup-node@${actionAllowlist['actions/setup-node']}`,
    withValues: { 'node-version': 24, cache: 'pnpm' },
  },
  { kind: 'run' },
  { kind: 'run' },
  {
    kind: 'run',
    envValues: {
      APP_ENV: 'production',
      DATABASE_URL: githubExpression('secrets.DATABASE_URL'),
      DIRECT_URL: githubExpression('secrets.DIRECT_URL'),
      SUPABASE_URL: githubExpression('vars.SUPABASE_URL'),
      SUPABASE_JWKS_URL: githubExpression('vars.SUPABASE_JWKS_URL'),
      SUPABASE_ALLOWED_URL: githubExpression('vars.SUPABASE_URL'),
      SUPABASE_ALLOWED_JWKS_URL: githubExpression('vars.SUPABASE_JWKS_URL'),
      SUPABASE_ANON_KEY: githubExpression('secrets.SUPABASE_ANON_KEY'),
      SUPABASE_SERVICE_ROLE_KEY: githubExpression(
        'secrets.SUPABASE_SERVICE_ROLE_KEY',
      ),
      R2_BUCKET: 'cocolo-production-private',
      PUBLIC_APP_URL: githubExpression('vars.PUBLIC_APP_URL'),
      PUBLIC_APP_URL_ALLOWLIST: githubExpression(
        'vars.PUBLIC_APP_URL_ALLOWLIST',
      ),
      RETIRED_DATA_RETENTION_DAYS: githubExpression(
        'vars.RETIRED_DATA_RETENTION_DAYS',
      ),
      AUDIT_LOG_RETENTION_DAYS: githubExpression(
        'vars.AUDIT_LOG_RETENTION_DAYS',
      ),
    },
  },
  {
    kind: 'run',
    envValues: {
      DATABASE_URL: githubExpression('secrets.DATABASE_URL'),
      DIRECT_URL: githubExpression('secrets.DIRECT_URL'),
    },
  },
  {
    kind: 'run',
    envValues: {
      ARTIFACT_SHA: githubExpression('inputs.artifact_sha'),
      PRODUCTION_DEPLOY_ADAPTER: githubExpression(
        'secrets.PRODUCTION_DEPLOY_ADAPTER',
      ),
    },
  },
];

function asRecord(value: unknown, message: string): WorkflowRecord {
  assert.ok(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    message,
  );
  return value as WorkflowRecord;
}

function asArray(value: unknown, message: string): unknown[] {
  assert.ok(Array.isArray(value), message);
  return value;
}

function assertExactKeys(
  record: WorkflowRecord,
  expected: readonly string[],
  location: string,
): void {
  assert.deepEqual(
    Object.keys(record).sort(),
    [...expected].sort(),
    `${location}: 許可されていない項目または必須項目の欠落があります`,
  );
}

function assertExactRecord(
  value: unknown,
  expected: Record<string, unknown>,
  location: string,
): void {
  const record = asRecord(value, `${location}: objectが必要です`);
  assert.deepEqual(record, expected, `${location}: 許可された値と一致しません`);
}

function parseWorkflow(name: WorkflowName, content: string): WorkflowRecord {
  const document = parseDocument(content, { uniqueKeys: true });
  assert.equal(
    document.errors.length,
    0,
    `${name}: YAML構文が不正です: ${document.errors.map((error) => error.message).join('; ')}`,
  );
  return asRecord(
    document.toJS(),
    `${name}: Workflowのrootがobjectではありません`,
  );
}

function assertNoForbiddenValues(value: unknown, location: string): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries())
      assertNoForbiddenValues(item, `${location}[${String(index)}]`);
    return;
  }
  if (value === null || typeof value !== 'object') {
    if (value === 'pull_request_target' || value === 'workflow_run')
      assert.fail(`${location}: 禁止されたWorkflow構文です: ${value}`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    assert.notEqual(
      key,
      'pull_request_target',
      `${location}: 禁止されたWorkflow構文です: pull_request_target`,
    );
    assert.notEqual(
      key,
      'workflow_run',
      `${location}: 禁止されたWorkflow構文です: workflow_run`,
    );
    if (key === 'secrets' && child === 'inherit')
      assert.fail(`${location}.secrets: secrets: inheritは禁止です`);
    assertNoForbiddenValues(child, `${location}.${key}`);
  }
}

const expressionPattern = /\$\{\{([\s\S]*?)\}\}/g;
const safeExpressionBodies = new Set([
  'github.workflow',
  'github.event.pull_request.number || github.ref',
  "github.event_name == 'pull_request'",
  'github.sha',
  'github.token',
  'inputs.artifact_sha',
  'secrets.DATABASE_URL',
  'secrets.DIRECT_URL',
  'secrets.SUPABASE_ANON_KEY',
  'secrets.SUPABASE_SERVICE_ROLE_KEY',
  'secrets.STAGING_DEPLOY_ADAPTER',
  'secrets.STAGING_E2E_TEST_EMAIL',
  'secrets.STAGING_E2E_TEST_PASSWORD',
  'secrets.PRODUCTION_DEPLOY_ADAPTER',
  'vars.SUPABASE_URL',
  'vars.SUPABASE_JWKS_URL',
  'vars.PUBLIC_APP_URL',
  'vars.PUBLIC_APP_URL_ALLOWLIST',
  'vars.RETIRED_DATA_RETENTION_DAYS',
  'vars.AUDIT_LOG_RETENTION_DAYS',
]);

function assertNoUntrustedExpressions(value: unknown, location: string): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries())
      assertNoUntrustedExpressions(item, `${location}[${String(index)}]`);
    return;
  }
  if (value === null || typeof value !== 'object') {
    if (typeof value !== 'string') return;
    const matches = [...value.matchAll(expressionPattern)];
    if (value.includes('${{') && matches.length === 0)
      assert.fail(`${location}: 閉じていないGitHub expressionです`);
    if (location.endsWith('.run') && matches.length > 0)
      assert.fail(`${location}: GitHub contextをshellへ直接展開できません`);
    for (const match of matches) {
      const body = match[1]?.trim();
      assert.ok(body, `${location}: 空のGitHub expressionは許可しません`);
      assert.ok(
        safeExpressionBodies.has(body),
        `${location}: 未許可のGitHub contextまたはexpressionです: ${body}`,
      );
      if (
        body === 'github.workflow' ||
        body === 'github.event.pull_request.number || github.ref'
      )
        assert.equal(
          location,
          'quality.yml.concurrency.group',
          `${location}: concurrency以外でこのGitHub contextを使えません`,
        );
      if (body === "github.event_name == 'pull_request'")
        assert.equal(
          location,
          'quality.yml.concurrency.cancel-in-progress',
          `${location}: concurrency以外でこのGitHub contextを使えません`,
        );
      if (body === 'github.sha')
        assert.ok(
          location.endsWith('.env.ARTIFACT_SHA') ||
            location.endsWith('.with.name'),
          `${location}: github.shaの用途を許可していません`,
        );
      if (body === 'github.token')
        assert.equal(
          location,
          'production-promote.yml.jobs.production.steps[0].env.GH_TOKEN',
          `${location}: github.tokenはproductionの読み取り専用CLI用途だけに限定します`,
        );
      if (body === 'inputs.artifact_sha')
        assert.ok(
          location ===
            'production-promote.yml.jobs.production.steps[0].env.ARTIFACT_SHA' ||
            location ===
              'production-promote.yml.jobs.production.steps[8].env.ARTIFACT_SHA' ||
            location ===
              'production-promote.yml.jobs.production.steps[1].with.ref',
          `${location}: 手動入力を許可されたproductionのSHA用途以外へ渡せません`,
        );
      if (body.startsWith('secrets.') || body.startsWith('vars.'))
        assert.ok(
          location.includes('.env.'),
          `${location}: secretとvariableは許可されたstepのenvだけで参照します`,
        );
    }
    return;
  }
  for (const [key, child] of Object.entries(value))
    assertNoUntrustedExpressions(child, `${location}.${key}`);
}

function validateActionReference(value: unknown, location: string): void {
  assert.equal(
    typeof value,
    'string',
    `${location}: Action参照が文字列ではありません`,
  );
  const action = value as string;
  const separator = action.indexOf('@');
  assert.ok(separator > 0, `${location}: Actionはrepository@SHA形式が必要です`);
  const repository = action.slice(0, separator);
  const sha = action.slice(separator + 1);
  assert.match(sha, /^[0-9a-f]{40}$/, `${location}: Action SHAが不正です`);
  assert.equal(
    actionAllowlist[repository as keyof typeof actionAllowlist],
    sha,
    `${location}: 許可されていないActionまたはSHAです`,
  );
}

function validateStep(
  workflowName: WorkflowName,
  stepValue: unknown,
  policy: StepPolicy,
  index: number,
): void {
  const location = `${workflowName}.jobs.steps[${String(index)}]`;
  const step = asRecord(stepValue, `${location}: stepはobjectが必要です`);
  const expectedKeys = [
    'name',
    policy.kind,
    ...(policy.withValues ? ['with'] : []),
    ...(policy.envValues ? ['env'] : []),
  ];
  assertExactKeys(step, expectedKeys, location);
  assert.equal(typeof step.name, 'string', `${location}.name: 名前が必要です`);
  if (policy.kind === 'uses') {
    assert.equal(
      step.uses,
      policy.action,
      `${location}.uses: Actionが一致しません`,
    );
    validateActionReference(step.uses, `${location}.uses`);
  } else {
    assert.equal(
      typeof step.run,
      'string',
      `${location}.run: shell commandが必要です`,
    );
  }
  if (policy.withValues)
    assertExactRecord(step.with, policy.withValues, `${location}.with`);
  if (policy.envValues)
    assertExactRecord(step.env, policy.envValues, `${location}.env`);
}

function validateSteps(
  workflowName: WorkflowName,
  job: WorkflowRecord,
  steps: readonly StepPolicy[],
): void {
  const actualSteps = asArray(
    job.steps,
    `${workflowName}.jobs: stepsは配列が必要です`,
  );
  assert.equal(
    actualSteps.length,
    steps.length,
    `${workflowName}.jobs: step一覧が許可された構成と一致しません`,
  );
  actualSteps.forEach((step, index) => {
    const policy = steps[index];
    assert.ok(policy, `${workflowName}.jobs: step policyがありません`);
    validateStep(workflowName, step, policy, index);
  });
}

function validateQualityServices(job: WorkflowRecord): void {
  const services = asRecord(
    job.services,
    'quality.yml.jobs.quality.services: objectが必要です',
  );
  assertExactKeys(services, ['postgres'], 'quality.yml.jobs.quality.services');
  const postgres = asRecord(
    services.postgres,
    'quality.yml.jobs.quality.services.postgres: objectが必要です',
  );
  assertExactKeys(
    postgres,
    ['image', 'env', 'ports', 'options'],
    'quality.yml.jobs.quality.services.postgres',
  );
  assert.equal(postgres.image, 'postgres:17');
  assertExactRecord(
    postgres.env,
    {
      POSTGRES_USER: 'postgres',
      POSTGRES_PASSWORD: 'postgres',
      POSTGRES_DB: 'cocolo_test',
    },
    'quality.yml.jobs.quality.services.postgres.env',
  );
  assert.deepEqual(postgres.ports, ['5432:5432']);
  assert.equal(
    postgres.options,
    '--health-cmd "pg_isready -U postgres -d cocolo_test" --health-interval 10s --health-timeout 5s --health-retries 5',
  );
}

function validateQualityWorkflowDocument(workflow: WorkflowRecord): void {
  assertExactKeys(
    workflow,
    ['name', 'on', 'permissions', 'concurrency', 'jobs'],
    'quality.yml',
  );
  assert.equal(workflow.name, '品質ゲート');
  const triggers = asRecord(workflow.on, 'quality.yml.on: objectが必要です');
  assertExactKeys(
    triggers,
    ['pull_request', 'push', 'workflow_call'],
    'quality.yml.on',
  );
  assert.equal(triggers.pull_request, null);
  assertExactRecord(
    triggers.push,
    { branches: ['develop', 'main'] },
    'quality.yml.on.push',
  );
  assert.equal(triggers.workflow_call, null);
  assertExactRecord(
    workflow.permissions,
    { contents: 'read' },
    'quality.yml.permissions',
  );
  assertExactRecord(
    workflow.concurrency,
    {
      group: [
        'quality-',
        githubExpression('github.workflow'),
        '-',
        githubExpression('github.event.pull_request.number || github.ref'),
      ].join(''),
      'cancel-in-progress': githubExpression(
        "github.event_name == 'pull_request'",
      ),
    },
    'quality.yml.concurrency',
  );
  const jobs = asRecord(workflow.jobs, 'quality.yml.jobs: objectが必要です');
  assertExactKeys(jobs, ['quality'], 'quality.yml.jobs');
  const quality = asRecord(
    jobs.quality,
    'quality.yml.jobs.quality: objectが必要です',
  );
  assertExactKeys(
    quality,
    ['runs-on', 'timeout-minutes', 'services', 'steps'],
    'quality.yml.jobs.quality',
  );
  assert.equal(quality['runs-on'], 'ubuntu-24.04');
  assert.equal(quality['timeout-minutes'], 10);
  validateQualityServices(quality);
  validateSteps('quality.yml', quality, qualitySteps);
}

function validateStagingWorkflowDocument(workflow: WorkflowRecord): void {
  assertExactKeys(
    workflow,
    ['name', 'on', 'permissions', 'jobs'],
    'staging-deploy.yml',
  );
  assert.equal(workflow.name, 'ステージングへデプロイ');
  const triggers = asRecord(
    workflow.on,
    'staging-deploy.yml.on: objectが必要です',
  );
  assertExactKeys(triggers, ['push'], 'staging-deploy.yml.on');
  assertExactRecord(
    triggers.push,
    { branches: ['main'] },
    'staging-deploy.yml.on.push',
  );
  assertExactRecord(
    workflow.permissions,
    { contents: 'read', 'id-token': 'write', attestations: 'write' },
    'staging-deploy.yml.permissions',
  );
  const jobs = asRecord(
    workflow.jobs,
    'staging-deploy.yml.jobs: objectが必要です',
  );
  assertExactKeys(jobs, ['staging'], 'staging-deploy.yml.jobs');
  const staging = asRecord(
    jobs.staging,
    'staging-deploy.yml.jobs.staging: objectが必要です',
  );
  assertExactKeys(
    staging,
    ['runs-on', 'timeout-minutes', 'environment', 'steps'],
    'staging-deploy.yml.jobs.staging',
  );
  assert.equal(staging['runs-on'], 'ubuntu-24.04');
  assert.equal(staging['timeout-minutes'], 15);
  assert.equal(staging.environment, 'staging');
  validateSteps('staging-deploy.yml', staging, stagingSteps);
}

function validateProductionWorkflowDocument(workflow: WorkflowRecord): void {
  assertExactKeys(
    workflow,
    ['name', 'on', 'permissions', 'jobs'],
    'production-promote.yml',
  );
  assert.equal(workflow.name, '本番へ昇格');
  const triggers = asRecord(
    workflow.on,
    'production-promote.yml.on: objectが必要です',
  );
  assertExactKeys(triggers, ['workflow_dispatch'], 'production-promote.yml.on');
  assertExactRecord(
    triggers.workflow_dispatch,
    {
      inputs: {
        artifact_sha: { required: true, type: 'string' },
      },
    },
    'production-promote.yml.on.workflow_dispatch',
  );
  assertExactRecord(
    workflow.permissions,
    { contents: 'read', actions: 'read' },
    'production-promote.yml.permissions',
  );
  const jobs = asRecord(
    workflow.jobs,
    'production-promote.yml.jobs: objectが必要です',
  );
  assertExactKeys(jobs, ['production'], 'production-promote.yml.jobs');
  const production = asRecord(
    jobs.production,
    'production-promote.yml.jobs.production: objectが必要です',
  );
  assertExactKeys(
    production,
    ['runs-on', 'timeout-minutes', 'environment', 'concurrency', 'steps'],
    'production-promote.yml.jobs.production',
  );
  assert.equal(production['runs-on'], 'ubuntu-24.04');
  assert.equal(production['timeout-minutes'], 15);
  assert.equal(production.environment, 'production');
  assert.equal(production.concurrency, 'production-migration');
  validateSteps('production-promote.yml', production, productionSteps);
}

// 全Workflowの許可構造を検査する。未知のWorkflow名も実行経路の追加とみなして拒否する。
export function validateWorkflow(name: WorkflowName, content: string): void {
  const workflow = parseWorkflow(name, content);
  assertNoForbiddenValues(workflow, name);
  if (name === 'quality.yml') validateQualityWorkflowDocument(workflow);
  if (name === 'staging-deploy.yml') validateStagingWorkflowDocument(workflow);
  if (name === 'production-promote.yml')
    validateProductionWorkflowDocument(workflow);
  assertNoUntrustedExpressions(workflow, name);
}

// 既存テストとの互換性を保ちながら、quality.ymlも全Workflow検査と同じ経路で検査する。
export function validateQualityWorkflow(content: string): void {
  validateWorkflow('quality.yml', content);
}

async function main(): Promise<void> {
  const files = (await readdir(directory)).filter(
    (name) => name.endsWith('.yml') || name.endsWith('.yaml'),
  );
  assert.deepEqual(
    files.sort(),
    [...workflowFiles].sort(),
    '.github/workflowsには許可されたWorkflowだけを配置してください',
  );
  for (const file of workflowFiles)
    validateWorkflow(file, await readFile(path.join(directory, file), 'utf8'));
  console.log('GitHub Actions のWorkflow構造と信頼境界を検証しました。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
