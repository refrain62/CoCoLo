import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 必須workflowの存在と、Actions参照が40桁SHA固定であることを検査する。
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = path.join(root, '.github', 'workflows');
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// PR workflowの安全境界を固定し、危険な構文が別の検査成功で見逃されないようにする。
export function validateQualityWorkflow(quality: string) {
  assert.match(
    quality,
    /on:\s*\n[\s\S]*pull_request:/,
    'quality.yml: pull_request trigger が必要です',
  );
  assert.match(
    quality,
    /on:\s*\n[\s\S]*push:\s*\n\s+branches:\s*\[develop, main\]/,
    'quality.yml: develop/main push trigger が必要です',
  );
  assert.match(
    quality,
    /on:\s*\n[\s\S]*workflow_call:/,
    'quality.yml: workflow_call trigger が必要です',
  );
  assert.match(
    quality,
    /permissions:\s*\n\s+contents:\s*read/,
    'quality.yml: read-only permissions が必要です',
  );
  assert.match(
    quality,
    /concurrency:\s*\n[\s\S]*cancel-in-progress:\s*\$\{\{ github\.event_name == 'pull_request' \}\}/,
    'quality.yml: PRだけを中止するconcurrencyが必要です',
  );
  assert.match(
    quality,
    /runs-on:\s*ubuntu-24\.04\s*\n\s+timeout-minutes:\s+10/,
    'quality.yml: runnerとjob timeoutを固定してください',
  );
  assert.match(
    quality,
    /uses:\s*actions\/checkout@[0-9a-f]{40}[\s\S]*?with:\s*\n\s+persist-credentials:\s*false/,
    'quality.yml: checkoutのcredential保持を無効化してください',
  );

  for (const forbidden of [
    'pull_request_target',
    'workflow_run',
    'secrets: inherit',
  ]) {
    assert.doesNotMatch(
      quality,
      new RegExp(escapeRegExp(forbidden)),
      `quality.yml: 禁止されたWorkflow構文です: ${forbidden}`,
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
