import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  validateQualityWorkflow,
  validateWorkflow,
} from './verify-workflows.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readWorkflow = (name: string) =>
  readFile(path.join(root, '.github', 'workflows', name), 'utf8');

test('共有Workflowの正本を受け入れる', async () => {
  validateQualityWorkflow(await readWorkflow('quality.yml'));
  validateWorkflow(
    'staging-deploy.yml',
    await readWorkflow('staging-deploy.yml'),
  );
  validateWorkflow(
    'production-promote.yml',
    await readWorkflow('production-promote.yml'),
  );
  validateWorkflow(
    'pr-trust-gate.yml',
    await readWorkflow('pr-trust-gate.yml'),
  );
  validateWorkflow(
    'database-integrity.yml',
    await readWorkflow('database-integrity.yml'),
  );
});

test('品質ゲートのworkflow test接続を改変できない', async () => {
  const quality = await readWorkflow('quality.yml');
  assert.throws(() =>
    validateQualityWorkflow(
      quality.replace('pnpm test:workflows', 'pnpm test:unit'),
    ),
  );
});

test('deploy保護検証とactions writeを改変できない', async () => {
  const staging = await readWorkflow('staging-deploy.yml');
  assert.throws(() =>
    validateWorkflow(
      'staging-deploy.yml',
      staging.replace(
        'deployment_branch_policy.protected_branches == true',
        'true',
      ),
    ),
  );
  assert.throws(() =>
    validateWorkflow(
      'staging-deploy.yml',
      staging.replace('attestations: write', 'actions: write'),
    ),
  );
});
