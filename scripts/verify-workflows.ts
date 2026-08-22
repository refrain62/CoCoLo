import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';

// 必須workflowの存在と、Actions参照が40桁SHA固定であることを検査する。
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = path.join(root, '.github', 'workflows');
type WorkflowRecord = Record<string, unknown>;

function asRecord(value: unknown, message: string) {
  assert.ok(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    message,
  );
  return value as WorkflowRecord;
}

function asArray(value: unknown, message: string) {
  assert.ok(Array.isArray(value), message);
  return value as unknown[];
}

function parseQualityWorkflow(quality: string) {
  const document = parseDocument(quality, { uniqueKeys: true });
  assert.equal(
    document.errors.length,
    0,
    `quality.yml: YAML構文が不正です: ${document.errors.map((error) => error.message).join('; ')}`,
  );
  return asRecord(
    document.toJS(),
    'quality.yml: Workflowのrootがobjectではありません',
  );
}

function assertNoForbiddenValues(value: unknown, location: string): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries())
      assertNoForbiddenValues(item, location.concat('[', String(index), ']'));
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

function assertNoUntrustedRunContext(value: unknown, location: string): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries())
      assertNoUntrustedRunContext(
        item,
        location.concat('[', String(index), ']'),
      );
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'run' && typeof child === 'string')
      assert.doesNotMatch(
        child,
        /\$\{\{\s*github\./,
        `${location}.run: GitHub contextをshellへ直接展開できません`,
      );
    assertNoUntrustedRunContext(child, `${location}.${key}`);
  }
}

// PR workflowの安全境界をYAML構造単位で固定し、文字列コメントなどの偽装を許さない。
export function validateQualityWorkflow(quality: string) {
  const workflow = parseQualityWorkflow(quality);
  assertNoForbiddenValues(workflow, 'quality.yml');
  assertNoUntrustedRunContext(workflow, 'quality.yml');

  const triggers = asRecord(
    workflow.on,
    'quality.yml: onがobjectではありません',
  );
  assert.deepEqual(
    Object.keys(triggers).sort(),
    ['pull_request', 'push', 'workflow_call'],
    'quality.yml: 許可されたtriggerだけを指定してください',
  );
  assert.equal(
    triggers.pull_request,
    null,
    'quality.yml: pull_requestに条件を付けません',
  );
  assert.deepEqual(
    asRecord(triggers.push, 'quality.yml: pushがobjectではありません').branches,
    ['develop', 'main'],
    'quality.yml: develop/main push triggerが必要です',
  );
  assert.equal(
    triggers.workflow_call,
    null,
    'quality.yml: workflow_callにsecret/inputを付けません',
  );
  assert.deepEqual(
    workflow.permissions,
    { contents: 'read' },
    'quality.yml: root permissionsはcontents: readだけにしてください',
  );

  const concurrency = asRecord(
    workflow.concurrency,
    'quality.yml: concurrencyがobjectではありません',
  );
  assert.equal(
    typeof concurrency.group,
    'string',
    'quality.yml: concurrency.groupが必要です',
  );
  assert.equal(
    concurrency['cancel-in-progress'],
    ['$', '{', "{ github.event_name == 'pull_request' }}"].join(''),
    'quality.yml: PRだけを中止するconcurrencyが必要です',
  );

  const jobs = asRecord(
    workflow.jobs,
    'quality.yml: jobsがobjectではありません',
  );
  const qualityJob = asRecord(
    jobs.quality,
    'quality.yml: jobs.qualityが必要です',
  );
  assert.equal(
    qualityJob['runs-on'],
    'ubuntu-24.04',
    'quality.yml: runnerを固定してください',
  );
  assert.equal(
    qualityJob['timeout-minutes'],
    10,
    'quality.yml: job timeoutを10分に固定してください',
  );
  assert.equal(
    'permissions' in qualityJob,
    false,
    'quality.yml: job単位の権限を追加しないでください',
  );

  const checkoutSteps = asArray(
    qualityJob.steps,
    'quality.yml: jobs.quality.stepsが必要です',
  )
    .map((step) => asRecord(step, 'quality.yml: stepがobjectではありません'))
    .filter(
      (step) =>
        typeof step.uses === 'string' &&
        step.uses.startsWith('actions/checkout@'),
    );
  assert.ok(
    checkoutSteps.length > 0,
    'quality.yml: actions/checkoutが必要です',
  );
  for (const [index, step] of checkoutSteps.entries()) {
    const actionSha = (step.uses as string).split('@')[1];
    assert.match(
      actionSha ?? '',
      /^[0-9a-f]{40}$/,
      `quality.yml: checkout step ${index + 1}はSHA固定が必要です`,
    );
    const options = asRecord(
      step.with,
      `quality.yml: checkout step ${index + 1}のwithが必要です`,
    );
    assert.equal(
      options['persist-credentials'],
      false,
      `quality.yml: checkout step ${index + 1}のcredential保持を無効化してください`,
    );
  }
}

async function main() {
  const files: string[] = await readdir(directory).catch(() => [] as string[]);
  assert.ok(files.includes('quality.yml'), 'quality.yml が必要です');
  assert.ok(
    files.includes('staging-deploy.yml'),
    'staging-deploy.yml が必要です',
  );
  assert.ok(
    files.includes('production-promote.yml'),
    'production-promote.yml が必要です',
  );
  validateQualityWorkflow(
    await readFile(path.join(directory, 'quality.yml'), 'utf8'),
  );
  for (const file of files.filter(
    (name) => name.endsWith('.yml') || name.endsWith('.yaml'),
  )) {
    const content = await readFile(path.join(directory, file), 'utf8');
    for (const match of content.matchAll(/uses:\s*([^\s#]+)@([^\s#]+)/g)) {
      const actionSha = match[2];
      assert.ok(actionSha, `${file}: Action SHA が必要です`);
      assert.match(
        actionSha,
        /^[0-9a-f]{40}$/,
        `${file}: Action は SHA 固定が必要です: ${match[1]}`,
      );
    }
  }
  console.log('GitHub Actions のワークフローを検証しました。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
