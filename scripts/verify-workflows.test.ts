import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateQualityWorkflow } from './verify-workflows.ts';

function githubExpression(body: string) {
  return ['$', '{', '{ ', body, ' }}'].join('');
}

const validWorkflow = [
  'on:',
  '  pull_request:',
  '  push:',
  '    branches: [develop, main]',
  '  workflow_call:',
  'permissions:',
  '  contents: read',
  'concurrency:',
  [
    '  group: quality-',
    githubExpression('github.workflow'),
    '-',
    githubExpression('github.ref'),
  ].join(''),
  [
    '  cancel-in-progress: ',
    githubExpression("github.event_name == 'pull_request'"),
  ].join(''),
  'jobs:',
  '  quality:',
  '    runs-on: ubuntu-24.04',
  '    timeout-minutes: 10',
  '    steps:',
  '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
  '        with:',
  '          persist-credentials: false',
].join('\n');

test('quality workflowの安全条件を満たす構成を受け入れる', () => {
  assert.doesNotThrow(() => validateQualityWorkflow(validWorkflow));
});

test('pull_request_targetを含むworkflowを拒否する', () => {
  assert.throws(() =>
    validateQualityWorkflow(
      validWorkflow.replace('  pull_request:', '  pull_request_target:'),
    ),
  );
});

test('コメントでpull_requestを偽装するworkflowを拒否する', () => {
  assert.throws(() =>
    validateQualityWorkflow(
      validWorkflow.replace('  pull_request:', '  # pull_request:'),
    ),
  );
});

test('job単位のwrite権限を拒否する', () => {
  assert.throws(() =>
    validateQualityWorkflow(
      validWorkflow.replace(
        '    timeout-minutes: 10',
        '    timeout-minutes: 10\n    permissions:\n      contents: write',
      ),
    ),
  );
});

test('checkout credentialを保持するworkflowを拒否する', () => {
  assert.throws(() =>
    validateQualityWorkflow(
      validWorkflow.replace(
        'persist-credentials: false',
        'persist-credentials: true',
      ),
    ),
  );
});

test('checkout以外のstepにcredential設定を置く改変を拒否する', () => {
  assert.throws(() =>
    validateQualityWorkflow(
      validWorkflow.replace(
        '          persist-credentials: false',
        '      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020\n        with:\n          persist-credentials: false',
      ),
    ),
  );
});

test('runへのGitHub context直接展開を拒否する', () => {
  assert.throws(() =>
    validateQualityWorkflow(
      validWorkflow.replace(
        '    steps:',
        [
          '    steps:\n      - run: echo "',
          githubExpression('github.sha'),
          '"',
        ].join(''),
      ),
    ),
  );
});
