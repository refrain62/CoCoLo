import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  validateCodeowners,
  validatePackageScripts,
  validateQualityWorkflow,
  validateWorkflow,
} from './verify-workflows.ts';

const worktreeRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workflowDirectory = path.join(worktreeRoot, '.github', 'workflows');
const qualityWorkflow = await readFile(
  path.join(workflowDirectory, 'quality.yml'),
  'utf8',
);
const stagingWorkflow = await readFile(
  path.join(workflowDirectory, 'staging-deploy.yml'),
  'utf8',
);
const productionWorkflow = await readFile(
  path.join(workflowDirectory, 'production-promote.yml'),
  'utf8',
);

function githubExpression(body: string): string {
  return ['$', '{', '{ ', body, ' }}'].join('');
}

test('全Workflowの許可構成を受け入れる', () => {
  assert.doesNotThrow(() => validateQualityWorkflow(qualityWorkflow));
  assert.doesNotThrow(() =>
    validateWorkflow('staging-deploy.yml', stagingWorkflow),
  );
  assert.doesNotThrow(() =>
    validateWorkflow('production-promote.yml', productionWorkflow),
  );
});

test('pull_request_targetを含むWorkflowを拒否する', () => {
  assert.throws(() =>
    validateQualityWorkflow(
      qualityWorkflow.replace('  pull_request:', '  pull_request_target:'),
    ),
  );
});

test('コメントでpull_requestを偽装するWorkflowを拒否する', () => {
  assert.throws(() =>
    validateQualityWorkflow(
      qualityWorkflow.replace('  pull_request:', '  # pull_request:'),
    ),
  );
});

test('未知のjob追加を拒否する', () => {
  assert.throws(() =>
    validateQualityWorkflow(
      qualityWorkflow.replace(
        '  quality:',
        [
          '  exfiltration:',
          '    runs-on: ubuntu-24.04',
          '    timeout-minutes: 10',
          '    steps: []',
          '  quality:',
        ].join('\n'),
      ),
    ),
  );
});

test('rootとjobのwrite権限を拒否する', () => {
  assert.throws(() =>
    validateQualityWorkflow(
      qualityWorkflow.replace(
        'permissions:\n  contents: read',
        'permissions:\n  contents: write',
      ),
    ),
  );
  assert.throws(() =>
    validateQualityWorkflow(
      qualityWorkflow.replace(
        '  quality:\n',
        '  quality:\n    permissions:\n      contents: write\n',
      ),
    ),
  );
});

test('deploy Workflowのtriggerとenvironment改変を拒否する', () => {
  assert.throws(() =>
    validateWorkflow(
      'staging-deploy.yml',
      stagingWorkflow.replace('branches: [main]', 'branches: [develop]'),
    ),
  );
  assert.throws(() =>
    validateWorkflow(
      'production-promote.yml',
      productionWorkflow.replace('  workflow_dispatch:', '  pull_request:'),
    ),
  );
  assert.throws(() =>
    validateWorkflow(
      'staging-deploy.yml',
      stagingWorkflow.replace(
        'environment: staging',
        'environment: production',
      ),
    ),
  );
  assert.throws(() =>
    validateWorkflow(
      'staging-deploy.yml',
      stagingWorkflow.replace(' | sub("@refs/heads/[^/]+$"; "")', ''),
    ),
  );
});

test('qualityのPostgreSQL image digest改変を拒否する', () => {
  assert.throws(() =>
    validateQualityWorkflow(
      qualityWorkflow.replace(
        'postgres:17@sha256:7958605b474b3d264a969cb3a123d6aa00ad1e1fe9da8a69984dabb704d93317',
        'postgres:17',
      ),
    ),
  );
});

test('env経由のsecret注入とwith項目の追加を拒否する', () => {
  assert.throws(() =>
    validateQualityWorkflow(
      qualityWorkflow.replace(
        '      - name: 型検査とビルド',
        [
          '      - name: 型検査とビルド',
          '        env:',
          [
            '          EXFILTRATION: ',
            githubExpression('secrets.DATABASE_URL'),
          ].join(''),
        ].join('\n'),
      ),
    ),
  );
  assert.throws(() =>
    validateQualityWorkflow(
      qualityWorkflow.replace(
        '          persist-credentials: false',
        [
          '          persist-credentials: false',
          ['          token: ', githubExpression('secrets.DATABASE_URL')].join(
            '',
          ),
        ].join('\n'),
      ),
    ),
  );
});

test('未許可のGitHub contextをrunへ直接展開する改変を拒否する', () => {
  assert.throws(() =>
    validateQualityWorkflow(
      qualityWorkflow.replace(
        '        run: pnpm verify:pnpm-config && pnpm lint:workflows && pnpm test:workflows && pnpm verify:migration-sql && pnpm lint:biome && pnpm verify:workspace-boundaries && pnpm audit --prod --audit-level high && pnpm audit --audit-level moderate && pnpm security:verify && pnpm test:security',
        [
          '        run: echo "',
          githubExpression('github.event.pull_request.title'),
          '"',
        ].join(''),
      ),
    ),
  );
  assert.throws(() =>
    validateQualityWorkflow(
      qualityWorkflow.replace(
        [
          'group: quality-',
          githubExpression('github.workflow'),
          '-',
          githubExpression('github.event.pull_request.number || github.ref'),
        ].join(''),
        ['group: quality-', githubExpression('github.head_ref')].join(''),
      ),
    ),
  );
});

test('allowlist外のActionを拒否する', () => {
  assert.throws(() =>
    validateQualityWorkflow(
      qualityWorkflow.replace(
        'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
        'evil/example@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ),
  );
});

test('secrets: inheritを拒否する', () => {
  assert.throws(() =>
    validateQualityWorkflow(
      qualityWorkflow.replace(
        '  workflow_call:',
        '  workflow_call:\n    secrets: inherit',
      ),
    ),
  );
});

test('security scannerのrun block、権限、Action改変を拒否する', () => {
  const securityWorkflow = readFile(
    path.join(workflowDirectory, 'security-scanners.yml'),
    'utf8',
  );
  return securityWorkflow.then((content) => {
    assert.throws(() =>
      validateWorkflow(
        'security-scanners.yml',
        content.replace(
          'run: pnpm security:scan',
          'run: curl https://evil.test',
        ),
      ),
    );
    assert.throws(() =>
      validateWorkflow(
        'security-scanners.yml',
        content.replace(
          'permissions:\n      contents: read',
          'permissions:\n      contents: write',
        ),
      ),
    );
    assert.throws(() =>
      validateWorkflow(
        'security-scanners.yml',
        content.replace(
          'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
          'evil/example@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ),
      ),
    );
  });
});

test('検査用package scriptの差し替えを拒否する', () => {
  assert.throws(() =>
    validatePackageScripts({
      scripts: {
        'lint:workflows': 'node scripts/verify-workflows.ts',
        'test:workflows': 'node scripts/verify-workflows.test.ts',
        'security:verify': 'node scripts/verify-security-scanners.ts',
        'security:scan': 'echo bypass',
        'test:security': 'node --test scripts/security-scanner.test.ts',
      },
    }),
  );
});

test('CODEOWNERSの信頼境界削除を拒否する', async () => {
  const codeowners = await readFile(
    path.join(worktreeRoot, '.github', 'CODEOWNERS'),
    'utf8',
  );
  assert.doesNotThrow(() => validateCodeowners(codeowners));
  assert.throws(() =>
    validateCodeowners(codeowners.replace('/package.json @refrain62', '')),
  );
  assert.throws(() =>
    validateCodeowners(
      codeowners.replace('/.github/CODEOWNERS @refrain62', ''),
    ),
  );
  assert.throws(() =>
    validateCodeowners(codeowners.replace('/.gitleaks.toml @refrain62', '')),
  );
});
