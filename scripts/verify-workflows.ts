import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';
import { securityScanRoot } from './security-scan-root.ts';

// Workflowはbase側のvalidatorで読み込み、head側の変更で検査経路を差し替えられないようにする。
const root = securityScanRoot(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
);
const directory = path.join(root, '.github', 'workflows');

export const workflowFiles = [
  'database-integrity.yml',
  'e2e-daily.yml',
  'e2e-manual.yml',
  'e2e-weekly.yml',
  'pr-trust-gate.yml',
  'production-promote.yml',
  'quality.yml',
  'schema-drift.yml',
  'security-scanners.yml',
  'staging-deploy.yml',
] as const;

export type WorkflowName = (typeof workflowFiles)[number];
type WorkflowRecord = Record<string, unknown>;

function githubExpression(body: string): string {
  return ['$', '{', '{ ', body, ' }}'].join('');
}

const allowedActions = new Set([
  'actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8',
  'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
  'actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09',
  'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
  'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  'actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444',
  'actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f',
  'pnpm/action-setup@f40ffcd9367d9f12939873eb1018b921a783ffaa',
  'pnpm/action-setup@f520eceda224fe1a4aed5a2a27a194379a409996',
]);

const writablePermissions = new Set(['attestations', 'id-token', 'issues']);

function asRecord(value: unknown, location: string): WorkflowRecord {
  assert.ok(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    `${location}: objectが必要です`,
  );
  return value as WorkflowRecord;
}

function asArray(value: unknown, location: string): unknown[] {
  assert.ok(Array.isArray(value), `${location}: arrayが必要です`);
  return value;
}

function parseWorkflow(name: WorkflowName, content: string): WorkflowRecord {
  const document = parseDocument(content, { uniqueKeys: true });
  assert.equal(
    document.errors.length,
    0,
    `${name}: YAML構文が不正です: ${document.errors.map((error) => error.message).join('; ')}`,
  );
  return asRecord(document.toJS(), `${name}: rootはobjectが必要です`);
}

function validateAction(value: unknown, location: string): void {
  assert.equal(typeof value, 'string', `${location}: Action参照が必要です`);
  assert.ok(
    allowedActions.has(value as string),
    `${location}: 許可されていないActionまたはSHAです`,
  );
  const sha = (value as string).split('@').at(-1) ?? '';
  assert.match(sha, /^[0-9a-f]{40}$/, `${location}: Action SHAが不正です`);
}

function validatePermissions(value: unknown, location: string): void {
  const permissions = asRecord(value, location);
  assert.notEqual(
    permissions['write-all'],
    true,
    `${location}: write-allは禁止です`,
  );
  assert.notEqual(
    permissions['read-all'],
    false,
    `${location}: read-allの曖昧な指定は禁止です`,
  );
  for (const [permission, access] of Object.entries(permissions)) {
    if (access === 'write')
      assert.ok(
        writablePermissions.has(permission),
        `${location}.${permission}: 不要なwrite権限は禁止です`,
      );
  }
}

function walkWorkflow(
  value: unknown,
  location: string,
  name: WorkflowName,
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      walkWorkflow(entry, `${location}[${String(index)}]`, name);
    });
    return;
  }
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' && value.includes('${{'))
      assert.ok(
        value.match(/\$\{\{[\s\S]*\}\}/g),
        `${location}: 閉じていないGitHub expressionです`,
      );
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'uses') validateAction(child, `${location}.${key}`);
    if (key === 'permissions') validatePermissions(child, `${location}.${key}`);
    if (key === 'image' && typeof child === 'string')
      assert.match(
        child,
        /@sha256:[0-9a-f]{64}$/,
        `${location}.${key}: image digestが必要です`,
      );
    if (key === 'run' && typeof child === 'string')
      assert.doesNotMatch(
        child,
        /\$\{\{/,
        `${location}.${key}: GitHub contextをshellへ直接展開できません`,
      );
    if (key === 'workflow_run')
      assert.fail(`${location}.${key}: workflow_runは禁止です`);
    if (key === 'pull_request_target')
      assert.ok(
        (name === 'security-scanners.yml' || name === 'pr-trust-gate.yml') &&
          location === `${name}.on`,
        `${location}.${key}: pull_request_targetはbase側のtrust Workflowだけに許可します`,
      );
    if (key === 'secrets' && child === 'inherit')
      assert.fail(`${location}.${key}: secrets: inheritは禁止です`);
    walkWorkflow(child, `${location}.${key}`, name);
  }
}

function stepsOf(job: WorkflowRecord, location: string): WorkflowRecord[] {
  return asArray(job.steps, `${location}.steps`).map((step, index) =>
    asRecord(step, `${location}.steps[${String(index)}]`),
  );
}

function hasRun(steps: readonly WorkflowRecord[], fragment: string): boolean {
  return steps.some(
    (step) => typeof step.run === 'string' && step.run.includes(fragment),
  );
}

function requireJob(workflow: WorkflowRecord, name: string): WorkflowRecord {
  const jobs = asRecord(workflow.jobs, 'jobs');
  return asRecord(jobs[name], `jobs.${name}`);
}

function validateAggregateGate(
  job: WorkflowRecord,
  resultName: string,
  location: string,
): void {
  assert.equal(
    job.if,
    githubExpression('always()'),
    `${location}.if: always()が必要です`,
  );
  assert.deepEqual(job.needs, [resultName], `${location}.needsが不正です`);
  const steps = stepsOf(job, location);
  assert.equal(steps.length, 1, `${location}.stepsは固定1 stepが必要です`);
  assert.match(
    String(steps[0]?.run ?? ''),
    new RegExp(
      `\\$${resultName.toUpperCase()}_RESULT.*!= ["']success["']`,
      's',
    ),
    `${location}: upstream結果をfail-closedに検査してください`,
  );
}

function validateQualityDocument(workflow: WorkflowRecord): void {
  const triggers = asRecord(workflow.on, 'quality.yml.on');
  assert.ok('pull_request' in triggers, 'quality.yml: pull_requestが必要です');
  assert.deepEqual(
    triggers.push,
    { branches: ['develop', 'main'] },
    'quality.yml.on.pushが不正です',
  );
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const quality = requireJob(workflow, 'quality');
  assert.equal(quality['runs-on'], 'ubuntu-24.04');
  assert.ok(Number(quality['timeout-minutes']) > 0);
  assert.ok(
    hasRun(stepsOf(quality, 'quality.yml.jobs.quality'), 'pnpm ci:fast'),
  );
  const gate = requireJob(workflow, 'gate');
  assert.equal(gate.name, 'quality aggregate gate');
  validateAggregateGate(gate, 'quality', 'quality.yml.jobs.gate');
}

function validateSecurityWorkflow(
  workflow: WorkflowRecord,
  content: string,
): void {
  const triggers = asRecord(workflow.on, 'security-scanners.yml.on');
  assert.equal(triggers.pull_request_target, null);
  assert.deepEqual(triggers.push, { branches: ['develop', 'main'] });
  assert.deepEqual(triggers.schedule, [{ cron: '17 3 * * *' }]);
  assert.ok(!('pull_request' in triggers));
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.doesNotMatch(
    content,
    /secrets\s*:|environment\s*:|upload-artifact|deploy/i,
  );

  const trust = requireJob(workflow, 'trust');
  assert.deepEqual(trust.permissions, { contents: 'read' });
  const trustSteps = stepsOf(trust, 'security-scanners.yml.jobs.trust');
  assert.ok(
    trustSteps.some(
      (step) =>
        typeof step.uses === 'string' &&
        step.uses.startsWith('actions/checkout@') &&
        asRecord(step.with, 'trust checkout.with').ref ===
          githubExpression(
            "github.event_name == 'push' && github.event.before || github.event.pull_request.base.sha || github.sha",
          ),
    ),
  );
  assert.ok(hasRun(trustSteps, 'prepare-security-target.ts'));
  assert.ok(hasRun(trustSteps, 'verify-security-trust.ts'));
  assert.ok(hasRun(trustSteps, 'TRUSTED_BASE_SHA="$TRUST_BASE_SHA"'));

  const config = requireJob(workflow, 'config');
  assert.equal(config.needs, 'trust');
  assert.ok(
    hasRun(
      stepsOf(config, 'security-scanners.yml.jobs.config'),
      'security:verify',
    ),
  );
  assert.ok(
    hasRun(
      stepsOf(config, 'security-scanners.yml.jobs.config'),
      'lint:workflows',
    ),
  );
  assert.ok(
    hasRun(
      stepsOf(config, 'security-scanners.yml.jobs.config'),
      'test:security',
    ),
  );

  const scanners = requireJob(workflow, 'scanners');
  assert.equal(scanners.needs, 'config');
  assert.ok(
    hasRun(
      stepsOf(scanners, 'security-scanners.yml.jobs.scanners'),
      'security:scan',
    ),
  );

  const gate = requireJob(workflow, 'gate');
  assert.equal(gate.if, githubExpression('always()'));
  assert.deepEqual(gate.needs, ['trust', 'config', 'scanners']);
  const gateSteps = stepsOf(gate, 'security-scanners.yml.jobs.gate');
  assert.equal(gateSteps.length, 1);
  const gateRun = String(gateSteps[0]?.run ?? '');
  for (const result of ['TRUST_RESULT', 'CONFIG_RESULT', 'SCANNERS_RESULT'])
    assert.match(
      gateRun,
      new RegExp(`\\$${result}.*!= ["']success["']`),
      `${result}をfail-closedに検査してください`,
    );
  assert.match(gateRun, /GITHUB_STEP_SUMMARY/);
}

function validateDeployWorkflows(
  name: 'staging-deploy.yml' | 'production-promote.yml',
  workflow: WorkflowRecord,
): void {
  const triggers = asRecord(workflow.on, `${name}.on`);
  assert.deepEqual(Object.keys(triggers), ['workflow_dispatch']);
  const jobName = name === 'staging-deploy.yml' ? 'staging' : 'production';
  const job = requireJob(workflow, jobName);
  assert.equal(
    job.if,
    githubExpression("vars.DEPLOYMENT_PROTECTION_ENABLED == 'true'"),
    `${name}: deploy protectionが必要です`,
  );
  assert.equal(
    job.environment,
    name === 'staging-deploy.yml' ? 'staging' : 'production',
  );
  const steps = stepsOf(job, `${name}.jobs.${jobName}`);
  assert.ok(steps.length > 0);
  if (name === 'staging-deploy.yml') {
    assert.match(String(steps[0]?.run ?? ''), /GITHUB_REF.*refs\/heads\/main/);
    assert.ok(hasRun(steps, 'security-scanners.yml'));
    assert.ok(hasRun(steps, 'quality.yml'));
    assert.ok(hasRun(steps, 'ARTIFACT_SHA'));
  } else {
    const inputs = asRecord(
      triggers.workflow_dispatch,
      `${name}.on.workflow_dispatch`,
    );
    const artifact = asRecord(
      inputs.inputs,
      `${name}.on.workflow_dispatch.inputs`,
    ).artifact_sha;
    assert.deepEqual(artifact, { required: true, type: 'string' });
    assert.ok(hasRun(steps, 'security-scanners.yml'));
    assert.ok(hasRun(steps, 'quality.yml'));
    assert.ok(
      steps.some(
        (step) =>
          typeof step.uses === 'string' &&
          step.uses.startsWith('actions/checkout@') &&
          asRecord(step.with, `${name}.checkout.with`).ref ===
            githubExpression('inputs.artifact_sha'),
      ),
    );
  }
}

function validateTrustWorkflow(workflow: WorkflowRecord): void {
  const triggers = asRecord(workflow.on, 'pr-trust-gate.yml.on');
  assert.equal(triggers.pull_request_target, null);
  assert.deepEqual(workflow.permissions, {
    contents: 'read',
    'pull-requests': 'read',
  });
  const job = requireJob(workflow, 'trusted-validation');
  const steps = stepsOf(job, 'pr-trust-gate.yml.jobs.trusted-validation');
  assert.ok(hasRun(steps, 'verify-trusted-pr.ts'));
}

function validateSchemaDriftWorkflow(workflow: WorkflowRecord): void {
  const triggers = asRecord(workflow.on, 'schema-drift.yml.on');
  assert.ok('workflow_dispatch' in triggers);
  const job = requireJob(workflow, 'schema-drift');
  assert.ok(
    hasRun(
      stepsOf(job, 'schema-drift.yml.jobs.schema-drift'),
      'verify:schema-drift',
    ),
  );
}

export function validateWorkflow(name: WorkflowName, content: string): void {
  const workflow = parseWorkflow(name, content);
  walkWorkflow(workflow, name, name);
  assert.ok(workflow.name, `${name}: nameが必要です`);
  assert.ok(workflow.permissions, `${name}: root permissionsが必要です`);
  if (name === 'quality.yml') validateQualityDocument(workflow);
  if (name === 'security-scanners.yml')
    validateSecurityWorkflow(workflow, content);
  if (name === 'staging-deploy.yml' || name === 'production-promote.yml')
    validateDeployWorkflows(name, workflow);
  if (name === 'pr-trust-gate.yml') validateTrustWorkflow(workflow);
  if (name === 'schema-drift.yml') validateSchemaDriftWorkflow(workflow);
}

export function validateQualityWorkflowContent(content: string): void {
  validateWorkflow('quality.yml', content);
}

// 旧テストと外部検証から使われる互換名。
export { validateQualityWorkflowContent as validateQualityWorkflow };

export function validatePackageScripts(value: unknown): void {
  const packageJson = asRecord(value, 'package.json');
  const scripts = asRecord(packageJson.scripts, 'package.json.scripts');
  const expected = {
    'lint:workflows': 'node scripts/verify-workflows.ts',
    'test:workflows': 'node --test scripts/verify-workflows.test.ts',
    'security:trust': 'node scripts/verify-security-trust.ts',
    'security:verify': 'node scripts/verify-security-scanners.ts',
    'security:scan': 'node scripts/run-security-scanners.ts',
    'test:security': 'node --test scripts/security-scanner.test.ts',
  } as const;
  for (const [name, command] of Object.entries(expected))
    assert.equal(
      scripts[name],
      command,
      `package.json scripts.${name}が不正です`,
    );
}

export function validateCodeowners(content: string): void {
  const lines = new Set(
    content
      .replaceAll('\r\n', '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')),
  );
  for (const required of [
    '/.github/workflows/* @refrain62',
    '/.github/security/* @refrain62',
    '/.github/CODEOWNERS @refrain62',
    '/.gitleaks.toml @refrain62',
    '/.semgrep/ci.yml @refrain62',
    '/.trivy-secret.yaml @refrain62',
    '/package.json @refrain62',
    '/pnpm-lock.yaml @refrain62',
    '/scripts/** @refrain62',
  ])
    assert.ok(
      lines.has(required),
      `CODEOWNERSのowner境界が欠落しています: ${required}`,
    );
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
  validatePackageScripts(
    JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')),
  );
  validateCodeowners(
    await readFile(path.join(root, '.github', 'CODEOWNERS'), 'utf8'),
  );
  console.log('GitHub Actions のWorkflow構造と信頼境界を検証しました。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
