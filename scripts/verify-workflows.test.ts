import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateQualityWorkflow } from './verify-workflows.ts';

const validWorkflow = [
  'on:',
  '  pull_request:',
  '  push:',
  '    branches: [develop, main]',
  '  workflow_call:',
  'permissions:',
  '  contents: read',
  'concurrency:',
  '  group: quality-${{ github.workflow }}-${{ github.ref }}',
  "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
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
